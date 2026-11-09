import type { ChartInfo, HudElement, LocalChart, RuntimeNote, Settings } from '../types';
import { Judge } from './judge';
import { HudTextRenderer } from './hud-text';
import { activeHitEffects, autoplayHoldTimes, createHitEffect, HitEffectRenderer } from './hit-effects';
import { badNoteAlpha, gameplayMetrics, judgeLineColor, lateNoteAlpha, noteIsVisible, noteViewportScale, orderedNotes } from './gameplay-visuals';
import { ease } from './easing';
import { block_transform, block_state, blockingBlockAt, BlockTouchFeedback } from './blocks';
import { MusicLowPass } from './block-audio';
import { UnityUI, type SceneView } from './unity-ui';
import { entrancePhase, loadingDisplaySeconds, gameplayOpeningSeconds, gameplayEndingSeconds } from './play-entrance';
import { recordResult } from './result-records';
import { exportFrame, exportTimeline, type ExportScenes, type ExportTimeline } from './export-timeline';
import { resultMusicFile, resultMusicFiles } from './result-music';
import { renderVideo } from './export/render-job';
import { renderAudio } from './export/audio';
import { checkCancelled, type ExportBackend } from './export/types';
import { videoFormats, type BrowserCodec, type EncodingOptions, type FFmpegCodec } from './export/options';
import './canvas';
import { linear, find_event, init_speed_events, merge_notes, init_note_fp, get_event_val, get_fp, rotate_point } from './timeline';
import { createLineStateResolver, lineAppearance } from './chart-state';
import { chartHoldSpan, chartNoteGeometry } from './chart-note-geometry';
import { ChartTextures, textureIsVisible } from './chart-textures';
import { ChartFonts } from './chart-fonts';
import { SpriteTints } from './sprite-tints';
import { applyHudAttachment, gameHudLayout, hudAttachment, hudPointCovered, inverseHudPoint } from './chart-hud';
import { chartViewport, hasChartViewport, resolveChartAspect } from './chart-viewport';
import { lineVisualKind, orderedLines, rpeLineSize } from './chart-lines';

// Original rendering state includes optional uniforms for chart-specific effect passes.
const C: any = {
    note: { tap: 1, drag: 2, hold: 3, flick: 4 },
    units: { pgrw: 0.05625, pgrh: 0.6, pgrbeat: 60 / 32 },
    linew: 0.0075,
    lineh: gameplayMetrics.lineHalfLength,
    pcolor: [0xff, 0xec, 0x9f],
    palpha: 0xe1 / 0xff,

    /* 方块材质，数值逐条抄自 ActiveBlock.mat / DisabledBlock.mat / ReadyBlock.mat。

       原版方块不是「红方块 + 噪声贴图」，而是四段 RT 管线：
         BlockArea/BlockSprite 画进 _NormalBlockRT/_SubtractBlockRT
           -> Unlit/BlockCompose  用 _DisplaceMap 位移后合成 _ComposeRT
           -> Unlit/EdgeMask 从 _ComposeRT 膨出描边 (_EffectRT)
           -> Unlit/ActiveBlock(全屏) 把 _ComposeRT/_EffectRT/_SceneColor 合成到屏幕
       位移图全程只做两件事：挪采样坐标、调制火花亮度 —— 它本身不出现在画面上。
       注意「挪采样坐标」挪的是 mask 和「取色用」的场景采样，不是画面里的背景：
       背景永远取未位移的那一份，否则方块内部会整片错位、边界处撕出接缝。 */
    block: {
        displaceStrength: 0.15,   // ActiveBlock/DisabledBlock 的 _DisplaceStrength
        displaceDir: [1, 1],      // _DisplaceDirection
        /* 位移图采样网格。原版 ActiveBlock 是 floor(uv * _ScreenParams / _BackgroundPixelScale)，
           格子 = 6×6 屏幕像素、取格心，格数跟着分辨率走。
           照抄原版，不做分辨率解耦。 */
        pixelScale: 6,            // ActiveBlock.mat is 6; TouchEffect's separate grid is 8.

        // 4.0.1.2 BlockRender.prefab edgeSize=1; RenderEffects has no GlowMask loop.

        /* 合成 mask 那一步（BlockCompose.mat）自己带一套位移参数，和全屏上色那一步
           （ActiveBlock/DisabledBlock）不是一组数。混用会把方块轮廓整体扯歪：
           _DisplaceMap_ST 决定噪声铺多密、_DisplaceStrength 决定抖多狠。

           BlockCompose 有两个 pass：主 pass（Active）拿 _NormalBlockRT/_SubtractBlockRT
           位移后相减；disabled pass 拿 _DisabledNormalBlockRT/_DisabledSubtractBlockRT，
           而那一趟里 _DisplaceMap/_Time 这些 uniform 压根没声明 —— 位移量就是 0，
           mask 按原始 uv 取。所以 disabled 的轮廓是干净矩形，抖的是 Active。 */
        compose: {
            displaceST: [2.13, 1.02], displaceSpeed: 2.59,
            displaceStrength: 0.1, displaceStrengthD: 0
        },

        // Unlit/ActiveBlock
        active: {
            fillColor: [0.7132075, 0.23549296, 0.23549296], fillOpacity: 0.667,
            fillStrength: 0.667,   // _FillStrength：填色向「场景色 hue 偏移 + 火花 overlay」靠多少
            edgeColor: [1, 0.33018857, 0.33018857], edgeOpacity: 0.8,
            sparkTint: [1, 0.28490567, 0.28490567], sparkOpacity: 5.69,
            sparkDisplace: 2.39, sparkHueShift: 0.2,
            displaceST: [0.8, 0.3], displaceSpeed: 1.5, displaceBlend: 0.411,
            sparkST: [3, 1.2]
        },
        /* Unlit/DisabledBlock 只编了 _RENDERPART_FILL 这一个变体（.mat 的 _InvalidKeywords
           就写着 _RENDERPART_FILL），出来只有「填色 + 火花」：_EdgeColor/_GlowColor/
           _SparkHueShiftAmount/_FillStrength 在材质里留着但这一变体根本不引用，所以不抄。
           填色公式是 cov * (_FillColor*_FillOpacity + 火花) —— _FillOpacity 乘的是颜色不是
           alpha，和 ActiveBlock 正好相反；变暗靠乘颜色，不是靠降不透明度。 */
        disabled: {
            fillColor: [0.497, 0.13766898, 0.13766898], fillOpacity: 0.4,
            sparkTint: [0.31132078, 0.077830195, 0.077830195], sparkOpacity: 3.5,
            sparkDisplace: 2.29,
            displaceST: [0.5, 0.2], displaceSpeed: 0.3,
            sparkST: [3, 1.2]
        },
        // Unlit/ReadyBlock：只有一层很暗的白色呼吸微光
        ready: { shineColor: [1, 1, 1], shineBrightness: 0.12, shineSpeed: 37.9 },

        imgs: {}
    },

    click_sounds: {},
    note_imgs: {},
    chart: {},
    hit_fx_imgs: { perfect: [], good: [] },
    // 自动演奏的分数/Combo 由谱面结算时间轴更新；combo >= 3 时显示数字和标签。
    game_hud: { score: 0, combo: 0, imgs: {} },
    scene: 'ready',
    sceneTransition: { from: 'game', to: 'game', start: 0, duration: 0, kind: 'loading' },
    loadingImage: null,
    loadingInfo: null,
    loadingTip: '',
    resultImage: null,
    resultStats: null,
    resultCollection: false,
    resultStarted: 0,
    gameOverAt: 0,
    postfx_enabled: true,
    fx_failed: false,
    block_enabled: true
};

const cv = document.querySelector<HTMLCanvasElement>("#main-canvas")!;
const actx = new AudioContext();
let settings: Settings;
const judge = new Judge();
let judgeFrameTime = 0;
let judgementSeconds = 0;
judge.now = () => judgementSeconds + (clock.running ? Math.max(0, (performance.now() - judgeFrameTime) / 1000) : 0);
const hit_effects = new HitEffectRenderer();
const originalUI = new UnityUI();
const blockFeedback = new BlockTouchFeedback();
const blockAudio = new MusicLowPass(actx);
judge.isBlocked = (x, y, time, width, height) => C.block_enabled && !!blockingBlockAt(C.chart.blocks || [], time, x, y, width, height);
const clear_block_input = (immediate = false) => {
    judge.clearInput();
    blockFeedback.clear();
    if (immediate) blockAudio.reset();
    else blockAudio.setBlocked(false);
};
const update_block_feedback = () => {
    const touches = settings.autoplay || C.video_export_active || !clock.running ? [] : judge.blockedTouches;
    blockFeedback.update(touches, performance.now() / 1000);
    blockAudio.setBlocked(touches.length > 0);
};
const events = new EventTarget();
let localUrls: string[] = [];
let finishSent = false;

const resultMusicBuffers = new Map<string, AudioBuffer>();
const resultMusicGain = actx.createGain();
resultMusicGain.connect(actx.destination);
let resultMusicSource: AudioBufferSourceNode | null = null;
const stopResultMusic = () => {
    if (!resultMusicSource) return;
    resultMusicSource.stop(); resultMusicSource.disconnect(); resultMusicSource = null;
};
const startResultMusic = (elapsed = 0) => {
    stopResultMusic();
    const buffer = resultMusicBuffers.get(resultMusicFile(C.chart.info?.level || ''));
    if (!buffer || C.video_export_active) return;
    const source = actx.createBufferSource();
    source.buffer = buffer; source.loop = true;
    resultMusicGain.gain.value = settings.volume;
    source.connect(resultMusicGain); source.start(0, Math.max(0, elapsed) % buffer.duration);
    resultMusicSource = source;
};

const sceneNow = () => performance.now() / 1000;
const transitionScene = (to: string) => {
    const from = C.scene;
    if (from === 'result' && to !== 'result') stopResultMusic();
    if (to === 'pause') {
        const snapshot = document.createElement('canvas'); snapshot.width = cv.width; snapshot.height = cv.height;
        snapshot.getContext('2d')!.drawImage(cv, 0, 0); C.pauseSnapshot = snapshot;
    }
    const kind = to === 'loading' ? 'loading-in'
        : to === 'result' ? 'result-in'
        : to === 'game-over' ? 'game-over'
        : to === 'pause' ? 'pause-in'
        : from === 'pause' ? 'pause-out'
        : from === 'loading' ? 'loading-out'
        : from === 'result' ? 'result-out'
        : 'loading-out';
    C.scene = to;
    cv.dataset.scene = to;
    const duration = to === 'result' ? originalUI.duration('LevelOvarAnimation')
        : to === 'game-over' ? gameplayEndingSeconds
        : to === 'game-opening' ? gameplayOpeningSeconds
        : to === 'loading-exit' ? originalUI.duration('StartInfoFadeOut')
        : to === 'loading' ? originalUI.duration('LevelStart')
        : from === 'pause' && to === 'game' ? originalUI.duration('Continue')
        : .5;
    C.sceneTransition = { from, to, start: sceneNow(), duration, kind };
    if (to === 'result') {
        startResultMusic();
        C.resultStarted = sceneNow();
        C.previousBest = recordResult(C.chart.dir || C.chart.info.name, C.resultStats?.score || 0);
        C.resultCollection = false;
        window.setTimeout(() => {
            if (C.scene === 'result' && Number(C.resultStats?.score || 0) >= 880000) C.resultCollection = true;
        }, 2000);
    }
};
const preparePlayback = () => {
    stopResultMusic();
    C.entrance = null; C.resumeAt = 0; C.gameOverAt = 0; C.scene = 'ready'; cv.dataset.scene = 'ready';
    C.sceneTransition = { from: 'ready', to: 'ready', start: sceneNow(), duration: 0, kind: 'none' };
    document.getElementById('stage')!.hidden = true;
};

const el = (id: string): any => document.querySelector(id);
const ui: any = {
    btn_play: el("#btn-play"),
    progress_wrap: el("#progress-wrap"),
    progress_marks: el("#progress-marks"),
    time_label: el("#time-label"),
    bottom_bar: el("#bottom-bar"),
    loading_overlay: el("#loading-overlay"),
    loading_fill: el("#loading-fill"),
    loading_text: el("#loading-text"),
    loading_label: el("#loading-label"),

    /* 视频导出面板 */
    btn_export: el("#btn-export"),
    export_overlay: el("#export-overlay"),
    export_close: el("#export-close"),
    export_backend: el("#exp-backend"),
    export_codec: el('#exp-codec'), export_container: el('#exp-container'), export_rate_control: el('#exp-rate-control'),
    export_crf: el('#exp-crf'), export_preset: el('#exp-preset'), export_pixel_format: el('#exp-pixel-format'),
    export_prores_profile: el('#exp-prores-profile'), export_audio_codec: el('#exp-audio-codec'),
    export_browser_codec: el('#exp-browser-codec'), export_hardware: el('#exp-hardware'), export_probe: el('#exp-probe'),
    export_keyframe: el('#exp-keyframe'), export_audio_bitrate: el('#exp-audio-bitrate'),
    export_threading: el('#exp-threading'), export_threads: el('#exp-threads'), export_isolation: el('#exp-isolation'),
    export_w: el("#exp-w"),
    export_h: el("#exp-h"),
    export_fps: el("#exp-fps"),
    export_bitrate: el("#exp-bitrate"),
    export_start: el("#exp-start"),
    export_end: el("#exp-end"),
    export_audio: el("#exp-audio"),
    export_loading: el("#exp-loading"),
    export_result: el("#exp-result"),
    export_result_seconds: el("#exp-result-seconds"),
    export_est: el("#exp-est"),
    export_p720: el("#exp-p720"),
    export_p1080: el("#exp-p1080"),
    export_pwin: el("#exp-pwin"),
    export_whole: el("#exp-whole"),
    export_here: el("#exp-here"),
    export_go: el("#exp-go"),
    export_cancel: el("#exp-cancel"),
    export_progress_wrap: el("#export-progress-wrap"),
    export_progress_fill: el("#export-progress-fill"),
    export_status: el("#export-status")
};

// ---- 部署基址 --------------------------------------------------------------
// 本地 Vite 开发服务时 BASE === "/"；部署到 GitHub Pages（子路径
// /PhigrosWebPlayer/）时 BASE === "/PhigrosWebPlayer/"。所有资源引用都过 R()，
// 同一份代码在根路径和子路径下都能跑，不用为部署维护第二份。
const BASE = new URL(".", document.baseURI).pathname;
// 把 "/xxx"（谱面库清单里的 path / asset / cover 就是这个形式）拼到基址后面
const R = (p: string) => /^(https?:|blob:|data:)/.test(p) ? p : BASE + String(p).replace(/^\/+/, "");

const load_audio = async (url, on_progress?) => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status}`);
    // 音频要 decodeAudioData，进度按字节比例报（解码耗时算不进进度条，但解码很快）
    return await actx.decodeAudioData(await read_with_progress(resp, on_progress));
};

const load_text = async url => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status}`);
    return await resp.text();
};

// 下载带进度：resp.body 缺失（老浏览器/被 polyfill 掉）时退化成一次读完，至少不报错。
// total 来自 Content-Length，没有就只报「已下载多少字节」，UI 侧当未知总量处理。
const read_with_progress = async (resp, on_progress) => {
    if (!on_progress) return await resp.arrayBuffer();
    const total = Number(resp.headers.get("content-length")) || 0;
    if (!resp.body || !resp.body.getReader) {
        const buf = await resp.arrayBuffer();
        on_progress(buf.byteLength, total || buf.byteLength);
        return buf;
    }
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
        const step = await reader.read();
        if (step.done) break;
        chunks.push(step.value);
        got += step.value.byteLength;
        on_progress(got, total);
    }
    const out = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    return out.buffer;
};

const play_sound = buf => {
    if (!buf) return;
    const source = actx.createBufferSource();
    source.buffer = buf;
    const gain = actx.createGain();
    gain.gain.value = settings?.hitVolume ?? 0.6;
    source.connect(gain).connect(actx.destination);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    source.start();
};
const note_sound = note => C.chart.hitsounds?.[note.hitsound] ?? C.click_sounds[note.type];
const sprite_tints = new SpriteTints();

const load_img = async (url: string): Promise<HTMLImageElement> => {
    const img = new Image();
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error(`图片加载失败：${url}`));
        img.src = url;
    });
    return img;
};

const load_json = async url => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${resp.status} ${url}`);
    return await resp.json();
};

const load_json_or_null = async url => {
    try {
        return await load_json(url);
    } catch (e) {
        return null;
    }
};

/* ---------------- 首玩异象资源装载 ---------------- */

/* WireNoise：原版是 Texture2DArray（R8，1024x1024 共 11 层），
   导出时切成 wirenoise_00..10.png。WebGL2 下拼成真正的 2DArray 上传；
   WebGL1 没有 sampler2DArray，只绑第 0 层（噪声不演化，其余观感保留）。 */
const fx_load_wirenoise = async (F, layers) => {
    const gl = F.gl;
    const imgs: HTMLImageElement[] = [];
    for (let i = 0; i < layers; i++)
        imgs.push(await load_img(R(`/assets/effects/wirenoise_${String(i).padStart(2, "0")}.png`)));

    if (F.caps.has_texpack) {
        const w = imgs[0].naturalWidth, h = imgs[0].naturalHeight;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, F.wireNoise);
        // ★ R8 单通道的行对齐：宽度 1024 是 4 的倍数，UNPACK_ALIGNMENT=1 仍最稳
        //   （某些实现对 RED/UNSIGNED_BYTE 的组合要求显式指定，否则 texSubImage3D
        //    会报 INVALID_OPERATION=1282）。
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, w, h, layers.length, 0,
                      gl.RED, gl.UNSIGNED_BYTE, null);
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d", { willReadFrequently: true })!;
        const r8 = new Uint8Array(w * h);
        for (let i = 0; i < layers.length; i++) {
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(imgs[i], 0, 0);
            const px = ctx.getImageData(0, 0, w, h).data;
            // PNG 是 RGBA，噪声在哪个通道不确定；取三通道最大值最稳
            for (let k = 0, n = w * h; k < n; k++) {
                const o = k * 4;
                r8[k] = Math.max(px[o], px[o + 1], px[o + 2]);
            }
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, w, h, 1,
                             gl.RED, gl.UNSIGNED_BYTE, r8);
        }
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);   // 复原，别影响后面的 2D 上传
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        F.noise_texel = [1 / w, 1 / h];
    } else {
        gl.bindTexture(gl.TEXTURE_2D, F.wireNoise);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgs[0]);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        F.noise_texel = [1 / imgs[0].naturalWidth, 1 / imgs[0].naturalHeight];
    }
};

/* 把 glitch 噪声图上传到 F.noise（Point+Repeat 由 mk_tex(true,true) 建纹理时设好，
   texImage2D 不会改采样参数）。带缓存守卫：按 img 对象身份比对，换图才重传。
   ★ audit F2（2026-10-06 修复）：原先唯一上传入口在 apply_postfx 的 if (!C.fx)
     首建分支里，两头都坏 —— ① fx_load_anomaly 先把 C.fx 建好 ⇒ 分支永不执行，
     而异象谱 postfx=null ⇒ C.glitch_img=null ⇒ F.noise 始终是无存储空纹理；
     ② 切谱（含 normal↔anomaly 互切）时 C.fx 已存在 ⇒ 换了 glitchTex 也不重传。 */
const fx_upload_noise = (F, img) => {
    if (!F || !img || F.noise_src === img) return;
    const gl = F.gl;
    gl.bindTexture(gl.TEXTURE_2D, F.noise);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    F.noise_src = img;
};

/* 方块噪声图的守卫式上传（BlockNoise1 = 位移图 / PointNoise = 火花图）。
   ★ 2026-10-17 修复：原先唯一上传入口在 apply_postfx 的 if (!C.fx) 首建分支里，
     与 glitch 噪声同款 bug（audit F2）——异象流程 fx_load_anomaly 会先把 C.fx 建好
     ⇒ 分支永不执行，u_disp/u_spark 永远是无存储空纹理：
       位移变「恒定偏移」（方块边缘纯直、整体错位），火花点全灭（红场变平色）。
     浏览器实测：手动重传后锯齿边 + 红色噪点场立现，与实机录像同族。 */
const fx_upload_block = (F) => {
    if (!F) return;
    const gl = F.gl;
    const dtex = C.block.imgs.displace, stex = C.block.imgs.spark;
    if (dtex && F.block_disp_src !== dtex) {
        gl.bindTexture(gl.TEXTURE_2D, F.displace);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, dtex);
        F.block_disp_src = dtex;
    }
    if (stex && F.block_spark_src !== stex) {
        gl.bindTexture(gl.TEXTURE_2D, F.spark);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stex);
        F.block_spark_src = stex;
    }
    for (const [key, texture] of [['touchNoise', F.touchNoise], ['touchHover', F.touchHover]]) {
        const image = C.block.imgs[key];
        if (image && F[key + '_src'] !== image) {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            F[key + '_src'] = image;
        }
    }
};

/* 载入某个异象（assets/effects/<name>.json）及其贴图，存到 C.fx_eff。
   ★ load_chart 跑的时候 C.fx 可能还没初始化（fx_init 是首次渲染时才懒初始化的），
     所以这里自己确保一次 —— 否则首屏选谱时异象会静默不生效。 */
const fx_load_anomaly = async (name) => {
    if (!C.fx) {
        try {
            C.fx = fx_init();
        } catch (e) {
            C.fx = null;
            C.fx_failed = true;
            console.error("异象载入时 WebGL 初始化失败：", e);
            return false;
        }
        // 不用在这里设尺寸：apply_postfx 每帧会按需重建 RT（见 C.fx.w !== w 分支）
    }
    const F = C.fx;
    if (!F) return false;
    const eff = await load_json_or_null(R(`/assets/effects/${name}.json`));
    if (!eff) return false;

    const gl = F.gl;
    eff._frozen = false;

    /* F2（audit 2026-10-06 修复）：异象 glitch 噪声贴图。原版三首各引
       Glitch4in1_{2,0,1}.png（Hate/DS/Message prefab 的 glitchTex guid 实测），
       但三张 PNG 字节全同（md5 a75e842efeeb23644766b5b7fa468af6，512×512 RGB，
       .meta filterMode:0 / wrapU,V:2 = Point+Repeat）⇒ 只提取一份共用。
       ★ 必须在这里上传：apply_postfx 首建分支不会执行（本函数已先建 C.fx）。 */
    fx_upload_noise(F, await load_img(R("/assets/effects/glitch4in1.png")));

    // GlitchDog 的两张图（三首共用）
    const gd = [await load_img(R("/assets/effects/glitchdog_glitchmap.png")),
                await load_img(R("/assets/effects/glitchdog_displace.png"))];
    gl.bindTexture(gl.TEXTURE_2D, F.glitchDogGlitchMap);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gd[0]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, F.glitchDogDisplace);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gd[1]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // WireNoise 只 DS 用得到（11 层）。无 WebGL2 时 GlitchDog 根本不跑，
    // 也就没必要下载这 2.8MB。
    if (eff.settings.glitchDog && F.caps.has_texpack) {
        const frames = (eff.settings.glitchDog.static || {}).noiseFrameCount || 11;
        await fx_load_wirenoise(F, Math.round(frames));
    } else {
        /* 不用 wireNoise 的曲子（Message/ハテ）什么都不用做 ——
           GlitchDog 那条 pass 会整个跳过，shader 不会被编译进来采样这张纹理。
           ★ 别在这里 "占位分配" 一下：对一张已经用 texImage3D 初始化过的
             2DArray 纹理再调 texImage3D（哪怕同尺寸）会报 INVALID_OPERATION(1282)。
             只把 noise_texel 复位，让没有该字段的场合有合理默认值。 */
        F.noise_texel = [1, 1];
    }

    // kaleido 的两张图（只有 Message 有）
    if (eff.kaleido_static) {
        const kn = await load_img(R("/assets/effects/kaleido_normal.png"));
        const kt = await load_img(R("/assets/effects/kaleido_col.png"));
        gl.bindTexture(gl.TEXTURE_2D, F.kaleidoNormal);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, kn);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, F.kaleidoTrans);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, kt);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    // DS 网格（Hidden/DsGrid 的 _MainTex = FrameBase_0，材质里平铺 10x10）
    if ((eff.imageTargets || []).some(x => x.target === "grid")) {
        const gt = await load_img(R("/assets/effects/dsgrid_main.png"));
        gl.bindTexture(gl.TEXTURE_2D, F.gridTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gt);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    C.fx_eff = eff;
    return true;
};

const clip_img = (img, y0, y1) => {
    const tempcv = document.createElement("canvas");
    tempcv.width = img.width;
    tempcv.height = y1 - y0;
    const tempctx = tempcv.getContext("2d")!;
    tempctx.drawImage(img, 0, -y0);
    return tempcv;
};

const clip_block_img = (img, x0, y0, x1, y1) => {
    const tempcv = document.createElement("canvas");
    tempcv.width = x1 - x0;
    tempcv.height = y1 - y0;
    const tempctx = tempcv.getContext("2d")!;
    tempctx.drawImage(img, -x0, -y0);
    return tempcv;
};

const clip_hold = (img, atlas) => {
    const tail = clip_img(img, 0, atlas[0]);
    const body = clip_img(img, atlas[0], img.height - atlas[1]);
    const head = clip_img(img, img.height - atlas[1], img.height);
    return [head, body, tail];
};

const load_audioele = async (url, on_progress?): Promise<HTMLAudioElement> => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = url;
    // <audio> 自己拉取，进度只能从 progress 事件拿（buffered ranges），粗略但可用
    if (on_progress) {
        const h = () => {
            if (audio.buffered.length > 0 && audio.duration) {
                const loaded = audio.buffered.end(audio.buffered.length - 1);
                on_progress(loaded, audio.duration);
            }
        };
        audio.addEventListener("progress", h);
        audio.addEventListener("canplaythrough", () => {
            audio.removeEventListener("progress", h);
            on_progress(audio.duration, audio.duration);
        });
    }
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error(`音乐加载超时：${url}`)); }, 60000);
        const cleanup = () => { clearTimeout(timer); audio.oncanplaythrough = null; audio.onerror = null; };
        audio.oncanplaythrough = () => { cleanup(); resolve(); };
        audio.onerror = () => { cleanup(); reject(new Error(`音乐无法解码或加载：${url}`)); };
        audio.load();
    });
    return audio;
};

// 事件选取复刻游戏 JudgeLineControl.UpdateJudgeLineEventIndex：索引单调前进到
// 「第一个 endTime > t 的事件」；t 落在事件间隙里时取的是「间隙之后那条」（再从它的
// startTime 反向外推）；t 超过全部事件时钳到最后一条。游戏永远不会出现「找不到事件」，
// 所以旧版在空隙/首事件之前直接 return -1 是错的 —— get_fp 会因此把 linefp 变成硬编码
// 的 0，note 位置整片错掉（实测 DS-AT line4 能偏到 -63782）。endTime 在合法谱面里随
// startTime 单调不减（连续或带间隙都成立），所以可以二分。
/* easeType -> f(p)。原版 GetEase.GetEaseWithProgress 不是直接算函数，而是把 [0,1] 按 1%
   采样成 101 项查表再线性插值；表由静态初始化生成，指数 n = (type-1)//3 + 2，
   (type-1)%3 决定 In / Out / InOut。13 = Zero（恒 0），14 = One（恒 1），
   15 = AnimationCurve 不在内置表里。枚举名和曲线并不一致（InSine 其实是二次幂，没有正弦）。
   这里照抄这份表，保证逐项和反编译结果一致。 */
// LevelControl.Start 加载 IllustrationBlur（256×135 / 6.25 PPU），不是高清曲绘。
// BackgroundScaler 的世界大小仍为40.96×21.6、scale=.463，宽屏继续等比放大。
// LeTai.Asset.TranslucentImage.ScalableBlur 再对屏幕捕获做四对角采样。
let game_background_cache: { image: any; fx: any; width: number; height: number; canvas: HTMLCanvasElement } | null = null;
const game_background = (w, h) => {
    const image = C.chart.background || C.chart.image;
    // 首个普通谱的背景绘制早于apply_postfx：在这里先建GL，不能缓存未模糊的首帧。
    if (!C.fx && !C.fx_failed) {
        try { C.fx = fx_init(); }
        catch (e) { console.error("背景 WebGL 初始化失败：", e); }
        if (!C.fx) C.fx_failed = true;
    }
    const F = C.fx;
    const old = game_background_cache;
    if (old && old.image === image && old.fx === F && old.width === w && old.height === h) return old;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const bctx = canvas.getContext("2d")!;
    const scale = h / image.height * 1.00008 * Math.max(1, (w / h) / (image.width / image.height));
    bctx.drawImage(image, (w - image.width * scale) / 2, (h - image.height * scale) / 2,
        image.width * scale, image.height * scale);
    if (F) {
        const gl = F.gl;
        const tex = F.background;
        fx_bind(gl, 0, tex[0]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        // Level.unity source186实际引用SongSelector Blur Config：radius7.1875/iteration4/maxDepth6。
        // ScalableBlur.Blur：目标依次/2,/4,/8,/16,/8,/4,/2,全尺寸，总计8趟。
        // ScaleWithResolution @0x32A75FC：短边/1080，钳到[.5,2]，避免大窗口模糊变浅。
        const radius = 7.1875 * Math.max(0.5, Math.min(2, Math.min(w, h) / 1080));
        let sw = w, sh = h, current = 0;
        for (const depth of [1, 2, 3, 4, 3, 2, 1, 0]) {
            const dw = Math.max(1, w >> depth), dh = Math.max(1, h >> depth);
            const next = 1 - current;
            fx_bind(gl, 0, tex[next]);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, dw, dh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            fx_pass(F.prog.backgroundBlur, tex[next], (p, gl) => {
                fx_bind(gl, 0, tex[current], p.loc.u_tex);
                gl.uniform2f(p.loc.u_step, radius / (2 * sw), radius / (2 * sh));
            }, [dw, dh]);
            current = next; sw = dw; sh = dh;
        }
        // 静态背景仅换曲绘/分辨率时回读；正常帧不运行模糊或readPixels。
        const rgba = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        const pixels = bctx.createImageData(w, h);
        for (let y = 0; y < h; y++) pixels.data.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), (h - y - 1) * w * 4);
        bctx.putImageData(pixels, 0, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        // 中间纹理不必跨帧保留全屏存储。
        for (const t of tex) {
            fx_bind(gl, 0, t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
    }
    // UI/TranslucentImage：黑色Image、spriteBlending=.5、brightness=.02、vibrancy=1。
    // 主背景与Cover共用这张静态结果；主背景另叠背景亮度遮罩，Cover不叠。
    const pixels = bctx.getImageData(0, 0, w, h);
    for (let i = 0; i < pixels.data.length; i += 4) {
        for (let c = 0; c < 3; c++) pixels.data[i + c] = Math.min(255, pixels.data[i + c] + 0.02 * 255) * 0.5;
        pixels.data[i + 3] = 255;
    }
    bctx.putImageData(pixels, 0, 0);
    game_background_cache = { image, fx: F, width: w, height: h, canvas };
    return game_background_cache;
};

const cv_put_color = (canvas, color) => {
    const c = canvas.getContext("2d");
    const imgdata = c.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < imgdata.data.length; i += 4) {
        imgdata.data.set([
            Math.floor(imgdata.data[i] * color[0] / 0xff),
            Math.floor(imgdata.data[i + 1] * color[1] / 0xff),
            Math.floor(imgdata.data[i + 2] * color[2] / 0xff),
            imgdata.data[i + 3]
        ], i);
    }
    c.putImageData(imgdata, 0, 0);
    return canvas;
};

/* ---------------- 播放时钟 ----------------
   音频负责声音，时钟负责画面。
   这样音频放完（S6 只有 68.5s，但演出到 73.1s）画面还能继续走完。 */

const clock = { base: 0, perf: 0, running: false };

const clock_t = () => clock.running
    ? clock.base + (performance.now() - clock.perf) / 1000 * (settings?.speed ?? 1)
    : clock.base;

const clock_seek = v => { clock.base = v; clock.perf = performance.now(); };

const clock_run = on => {
    if (on) {
        if (!clock.running) { clock.perf = performance.now(); clock.running = true; }
    } else if (clock.running) {
        clock.base = clock_t();
        clock.running = false;
    }
};

const get_time = () => {
    const m = C.chart.music;
    if (m && !m.paused && !m.ended && m.readyState >= 2) return m.currentTime;
    return clock_t();
};

/* ---------------- 曲线求值（方块事件 / 后期特效） ---------------- */

const curve_val = (keys, t) => {
    if (!keys || !keys.length) return 0;
    if (t <= keys[0][0]) return keys[0][1];
    const last = keys[keys.length - 1];
    if (t >= last[0]) return last[1];
    for (let i = 0; i + 1 < keys.length; i++) {
        const a = keys[i], b = keys[i + 1];
        if (t >= a[0] && t <= b[0]) {
            const span = b[0] - a[0];
            const p = span <= 0 ? 1 : (t - a[0]) / span;
            return a[1] + (b[1] - a[1]) * p;
        }
    }
    return last[1];
};

/* ---------------- 首玩异象：AnimationDirector 求值器 ----------------
   逐条对应 AnimationDirector.Evaluate @0x1D2B680（见 _analysis\resolve_effect_params.py）：
     跨过 endTime 取末帧 -> 跨过首帧之前取首帧的 endValue -> 线性找区间 ->
     p = (t - cur.time) / span -> easeType 15 走 AnimationCurve(Hermite)，否则查 ease 表 ->
     ★ 结果 clamp 到 [0,1]（游戏侧 fminf + <0 归零）-> start + ep*(end - start)

   ★ 切线直接用序列化的 inSlope/outSlope，**不**按 weightedMode/weight 重算：
     全项目 161 对加权段穷举 9 种加权公式最高仅 3/161 匹配，且无权重信息的
     10009 对用序列化切线求值形态正常（详见 HANDOFF §12.2）。 */

const hermite_curve_eval = (curve, t) => {
    if (!curve || !curve.length) return 0;
    if (curve.length === 1) return curve[0][1];
    if (t <= curve[0][0]) return curve[0][1];
    if (t >= curve[curve.length - 1][0]) return curve[curve.length - 1][1];

    let i = 0;
    while (i + 1 < curve.length - 1 && curve[i + 1][0] < t) i++;
    const a = curve[i], b = curve[i + 1];
    const dt = b[0] - a[0];
    if (dt <= 0) return a[1];

    const s = (t - a[0]) / dt;
    const s2 = s * s, s3 = s2 * s;
    // a[2] = outSlope（出切线），b[3] = inSlope（入切线）
    return (2 * s3 - 3 * s2 + 1) * a[1] + (s3 - 2 * s2 + s) * dt * a[2]
         + (-2 * s3 + 3 * s2) * b[1] + (s3 - s2) * dt * b[3];
};

/* keys = assets/effects/*.json 里压缩过的曲线：
   [time, startValue, endValue, easeType, curve|null] */
const director_eval = (keys, t) => {
    if (!keys || !keys.length) return 0;
    if (keys[0][0] > t) return keys[0][2];          // 首帧之前取首帧 endValue
    const n = keys.length;
    let i = 0;
    while (i < n - 1 && keys[i + 1][0] <= t) i++;
    const cur = keys[i];
    if (i === n - 1) return cur[2];                 // 末帧之后保持末值
    const span = keys[i + 1][0] - cur[0];
    if (span <= 0) return cur[2];
    const p = (t - cur[0]) / span;

    const et = cur[3];
    let ep = (et === 15) ? hermite_curve_eval(cur[4], p) : ease(p, et);
    ep = ep < 0 ? 0 : (ep > 1 ? 1 : ep);             // ★ 游戏侧 clamp
    return cur[1] + ep * (keys[i + 1][2] - cur[1]);
};

/* 一个已载入的异象定义（C.fx.eff）：曲线 + 静态默认值 + 时间闸。 */
const eff_ev = (eff, name, t) => director_eval(eff.curves[name], t);

/* 取某 settings 对象在 t 时刻的完整字段值：静态打底，被驱动的用曲线覆盖。 */
const eff_settings = (eff, obj, t) => {
    const d = eff.settings[obj];
    if (!d) return null;
    const st = Object.assign({}, d.static);
    for (const f in d.driven) st[f] = eff_ev(eff, d.driven[f], t);
    return st;
};

// 方块事件是按 time 的关键帧（没有 endTime），起点是上一个关键帧的值。
// 游戏语义：ease 来自 evs[i]（段起点事件），eased progress clamp 到 [0,1]。
/* ---------------- 方块层 ----------------
   BlockArea 四段时序：appear -> enable -> disable -> disappear
   [appear,enable) 用 Ready 材质（很暗的白色呼吸微光），[enable,disable) 用 Active，
   [disable,disappear) 用 Disabled。appear==enable / disable==disappear 时该段长度为 0。

   这里只负责把方块光栅化成两张 mask 贴图，对应原版那几个 w/8 的 mask RT
   （0xC0/0xC8 active、0xD0/0xD8 disabled∪ready、0xE0/0xE8 ready-only，见 HANDOFF §3.1）：
     C.block_cv     覆盖：R = Active，G = Disabled ∪ Ready，B = Ready
     C.block_sub_cv 减算：R = Active，G = Disabled ∪ Ready，B = Ready
   相位写到哪些通道（draw_block_mask 里的 PHASE_CH）：
     appear→enable（Ready）→ G 和 B；enable→disable（Active）→ R；disable→disappear → G。
   G 必须含 Ready：原版 r = composeD.x × readyRaw，appear 段还没有 disabled 覆盖，
   composeD 若不含 Ready 就恒为 0，方块微光永远出不来。B 只放 Ready，单独差出 readyRaw。
   分通道是必须的：原版 Active / Disabled / Ready 各有独立的 normal+subtract 一对 RT，谁都不
   减谁；要是减算只用一个通道，一个 Disabled 的 subtract 块就会把同位置的 Active 块也挖掉。
   两张画布按原版 RT 的尺寸 w/8 × h/8 光栅化（原版 mask 相机的 targetTexture 就是 /8，
   compose 也跑在 /8 上、Point 采样），坐标缩放做在 render_blocks 里，几何计算不用改。
   覆盖值已经乘过该块这一帧的淡入淡出系数（原版走 vertex color 的 alpha）。
   真正上色由后面的 WebGL 管线做（位移 -> 合成 -> 描边/辉光 -> 全屏叠加）。 */

// SafeDiv(num, den)：游戏用 |den| < ε ? 1.0 : num/den（ε 极小，只在 den≈0 时触发）
const draw_block_mask = (bctx, b, t, w, h, sub, countOnly = false) => {
    const st = block_state(b, t, settings.speed);
    if (!st || (!sub && st.alpha <= 0.002)) return false;

    const geom = block_transform(b, t, w, h);
    const { cx_px: cx, cy_px: cy, size_px: sz, rotation } = geom;
    const bw = sz.x, bh = sz.y;
    if (bw < 0.5 || bh < 0.5) return false;

    bctx.save();
    bctx.translate(cx, cy);
    bctx.rotate(-rotation * Math.PI / 180);

    // 通道值 = 覆盖 * 淡入淡出系数，直接写进颜色里（canvas 的 alpha 通道被预乘绑死了，不能用）
    // 通道约定和 phase 序号不是一回事：R=Active、G=Disabled∪Ready、B=Ready（见本节开头注释）。
    // Ready（phase 0）同时写 G 和 B：G 让 composeD 覆盖到 appear 段，B 单独留给 readyRaw。
    const PHASE_CH = [[1, 2], [0], [1]];
    const v = Math.round(255 * (sub ? 0.1 : 1) * (countOnly ? 1 : Math.min(1, st.alpha)));
    const col = [0, 0, 0];
    for (const ch of PHASE_CH[st.phase]) col[ch] = v;
    bctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    bctx.fillRect(-bw / 2, -bh / 2, bw, bh);

    bctx.restore();
    return true;
};

// 没有 WebGL 时的退路：把 mask 当纯色方块直接画上去，没有位移/火花/辉光
const draw_block_flat = (bctx, b, t, w, h, sub) => {
    const st = block_state(b, t, settings.speed);
    if (!st || st.alpha <= 0.002) return false;

    const geom = block_transform(b, t, w, h);
    const { cx_px: cx, cy_px: cy, size_px: sz, rotation } = geom;
    const bw = sz.x, bh = sz.y;
    if (bw < 0.5 || bh < 0.5) return false;

    bctx.save();
    bctx.globalAlpha = st.alpha;
    bctx.translate(cx, cy);
    bctx.rotate(-rotation * Math.PI / 180);

    const P = st.phase === 0 ? C.block.ready
        : st.phase === 1 ? C.block.active : C.block.disabled;
    if (sub) {
        bctx.globalCompositeOperation = "destination-out";
        bctx.fillStyle = "#000";
    } else {
        const c = st.phase === 0 ? P.shineColor : P.fillColor;
        const a = st.phase === 0 ? P.shineBrightness : P.fillOpacity;
        bctx.fillStyle = `rgba(${c.map(x => Math.round(x * 255)).join(",")},${a})`;
    }
    bctx.fillRect(-bw / 2, -bh / 2, bw, bh);

    // Disabled 没有描边（FILL-only 变体），只有 Active 描
    if (!sub && st.phase === 1) {
        const e = C.block.active;
        bctx.globalAlpha = st.alpha * e.edgeOpacity;
        bctx.strokeStyle = `rgb(${e.edgeColor.map(x => Math.round(x * 255)).join(",")})`;
        bctx.lineWidth = Math.max(1, h * 0.0015);
        bctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
    }

    bctx.restore();
    return true;
};

const render_blocks = (sctx, t) => {
    const blocks = C.chart.blocks;
    C.block_live = false;
    if (!C.block_enabled || !blocks || !blocks.length) return;

    const w = cv.width, h = cv.height;
    const mctx = C.block_cv.getContext("2d");
    const sctx2 = C.block_sub_cv.getContext("2d");
    const countCtx = C.block_sub_count_cv.getContext('2d');
    // mask 画布是 /8 分辨率（原版 mask RT 就是 w/8 × h/8），先把坐标系缩到 /8，
    // 下面画方块时仍用屏幕坐标，几何计算一行都不用改。
    // clearRect 必须在缩放之前用设备坐标清，否则清的范围也跟着被缩。
    const sx = w ? C.block_cv.width / w : 1, sy = h ? C.block_cv.height / h : 1;
    for (const c of [mctx, sctx2, countCtx]) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = 1;
        c.globalCompositeOperation = "source-over";
        c.clearRect(0, 0, C.block_cv.width, C.block_cv.height);
        // APK BlockSprite blend is SrcAlpha/One. Subtract keeps an independent
        // count channel and green fade channel for SubtractBlockBlender.
        c.globalCompositeOperation = "lighter"; // Native BlockSprite: SrcAlpha, One.
        c.scale(sx, sy);
    }

    let any = false;
    for (const b of blocks) {
        const ctx2 = b.isSubtract ? sctx2 : mctx;
        if (draw_block_mask(ctx2, b, t, w, h, b.isSubtract)) any = true;
        if (b.isSubtract) draw_block_mask(countCtx, b, t, w, h, true, true);
    }
    C.block_live = any || blockFeedback.visible.length > 0;

    // 只有在 WebGL 管线真的用不了的时候才退化成纯色方块。
    // 这条路径一旦和 WebGL 同时跑，场景画布上就留了一份没处理的方块，
    // 而 WebGL 那份被位移场抖过、轮廓对不齐，看上去就是「处理过的方块叠在未处理的方块上」。
    if (C.block_live && C.fx_failed) {
        for (const b of blocks) if (!b.isSubtract) draw_block_flat(sctx, b, t, w, h, false);
        for (const b of blocks) if (b.isSubtract) draw_block_flat(sctx, b, t, w, h, true);
        sctx.save();
        sctx.globalCompositeOperation = 'screen';
        for (const touch of blockFeedback.visible) {
            const radius = h * 0.253 * touch.scale;
            if (radius <= 0) continue;
            // Canvas fallback retains the native sprite footprint; procedural
            // noise/SDF composition requires the WebGL path.
            sctx.globalAlpha = 0.5;
            sctx.drawImage(C.block.imgs.touchHoverFlat, touch.x - radius, touch.y - radius, radius * 2, radius * 2);
        }
        sctx.restore();
    }
};

/* ---------------- 后期特效 ----------------
   Glitch -> RGBShift -> VignettePlus -> ESCControl(Brightness)
   逐条照 PostEffects_*.glsl 还原，曲线来自 postfx.json（重建自 C9S6LevelEffect）。

   Glitch      : 以 glitch.png 的 R/G/B 当三通道独立噪声场，方向与幅度每帧由 _Time 推出
                 （整屏共用一组，见 glitch_dirs），把 R/G/B 各自沿方向位移 (noise-0.5)*_GlitchRange
   RGBShift    : G/B 沿径向位移，量 = pow(len*_Deform, _Radius)。
                 _Radius 是指数，越大位移越小 —— 6.5 几乎看不出，3.5 才明显，
                 所以这条曲线是「从关到开」而不是从开到关。
   VignettePlus: tex * (1 - smoothstep((len-_Radius)/_Smooth) * _Darkness)
   ESCControl  : tex * _Brightness（S6 的 Saturation/Contrast 恒为 1）

   三张图的采样在 uv 空间做（和 shader 一致），所以径向距离是各向异性的。 */

/* ---------------- 着色器：独立文件 ----------------

   全部 GLSL 都在 /shader 下，main.js 不再内嵌。启动时一次性读入，
   按 `#include "key"` 递归展开（block_disp 被 cov 与 apply 共用）。
   uv 朝向、量化网格、通道语义等实现细节都写在各自的 .glsl 里。

     fx.vert           全屏三角形
     glitch.frag       ≈ PostEffects_Glitch
     rgbshift.frag     ≈ PostEffects_RGBShift
     vignette.frag     ≈ PostEffects_VignettePlus（应用趟）
     vignette_noise.frag ≈ PostEffects_VignettePlus（噪声生成趟，半分辨率 RT）
     esc.frag          ≈ PostEffects_ESCContol
     copy.frag         直通拷贝
     block_disp.glsl   位移场（被下面几个 include）
     block_cov.frag    ≈ Unlit/BlockCompose
     block_layers.frag ≈ Unlit/DisabledBlock（加法层，烘进场景）
     block_ring.frag   ≈ Unlit/EdgeMask + Unlit/GlowMask
     block_apply.frag  ≈ Unlit/ActiveBlock / ReadyBlock（disabled 由 block_layers 接管）

     首玩异象四件套（Chapter9 baseline 的 LevelEffects，原版 HLSLCC 产物见
     _analysis\shader_blob_c9_clean\）：
     glitchdog.frag        ≈ PostEffects/GlitchDog（DS 核心 pass，26 uniform）
     dimensionslash.frag   ≈ PostEffects/DimensionSlash（DS 的 5 条切口）
     lightband.frag        ≈ PostEffects/LightBand（Message 横向光带）
     kaleidoblackmask.frag ≈ Hidden/KaleidoBlackMask（Message 万花筒材质）
     blendmask.frag        ≈ blackMask UI Image（黑幕，bgAlpha 驱动）
     dsgrid.frag           ≈ Hidden/DsGrid（DS 背景网格，加法；真身见 shader_blob_c9）
     composeover.frag      note 层 alpha-over 合回背景层（分层渲染专用） */
const SHADER_FILES = {
    backgroundBlur: "backgroundblur.frag",
    fx_vs:       "fx.vert",
    // ES 3.00 版（GlitchDog 要 sampler2DArray，只能在 WebGL2 上跑，
    // 且 ES 1.00/3.00 的 shader 不能混用，所以 vertex 也要配一份）
    fx30_vs:     "fx30.vert",
    glitch:      "glitch.frag",
    rgbShift:    "rgbshift.frag",
    vignette:    "vignette.frag",
    vignetteNoise: "vignette_noise.frag",
    esc:         "esc.frag",
    copy:        "copy.frag",
    // 首玩异象
    glitchDog:   "glitchdog.frag",
    dimSlash:    "dimensionslash.frag",
    lightBand:   "lightband.frag",
    kaleido:     "kaleidoblackmask.frag",
    blendMask:   "blendmask.frag",
    dsGrid:      "dsgrid.frag",
    overCompose: "composeover.frag",
    bloom:       "bloom.frag",
    lensDist:    "lensdistortion.frag",
    block_disp:  "block_disp.glsl",
    block_touch: "block_touch.glsl",
    // 顺序有讲究：load_shaders 按下标顺序展开 #include，block_layers 里有
    // `#include "block_disp"`，排到 block_disp 前面会抛「shader include 找不到」
    block_layers: "block_layers.frag",
    block_cov:   "block_cov.frag",
    block_ring:  "block_ring.frag",
    block_apply: "block_apply.frag"
};

const SH: Record<string, string> = {};

/* 展开 `#include "key"`；成环或找不到都直接抛错，别让 shader 悄悄缺一段。 */
const shader_expand = (src, seen) => src.replace(
    /^[ \t]*#include[ \t]+"([A-Za-z0-9_]+)"[ \t]*$/gm,
    (m, key) => {
        if (!(key in SH)) throw new Error(`shader include 找不到: ${key}`);
        if (seen.includes(key)) throw new Error(`shader include 成环: ${seen.concat(key).join(" -> ")}`);
        return shader_expand(SH[key], seen.concat(key));
    }
);

const load_shaders = async () => {
    const keys = Object.keys(SHADER_FILES);
    const texts = await Promise.all(keys.map(k => load_text(R(`/assets/shaders/${SHADER_FILES[k]}`))));
    keys.forEach((k, i) => { SH[k] = texts[i]; });
    for (const k of keys) SH[k] = shader_expand(SH[k], [k]);
};

const fx_compile = (gl, type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
    return s;
};

/* defines = 注入 fragment shader 顶部的宏（如 FX_HAS_DERIV）。
   vs_key = 换 vertex shader（ES 3.00 的 shader 必须配 ES 3.00 的 vertex）。

   ★ ES 3.00 的 shader 首行必须是 `#version 300 es`，任何东西都不能加在它前面
     （包括 #define），所以有 defines 时只允许用于 ES 1.00 的 shader。 */
const fx_program = (gl, fs_src, defines?, vs_key?) => {
    if (defines && defines.length) {
        if (/^\s*#version/.test(fs_src))
            throw new Error("ES 3.00 shader 不能注入 #define（#version 必须在首行）");
        fs_src = defines.map(d => `#define ${d}\n`).join("") + fs_src;
    }
    const p = gl.createProgram();
    gl.attachShader(p, fx_compile(gl, gl.VERTEX_SHADER, SH[vs_key || "fx_vs"]));
    gl.attachShader(p, fx_compile(gl, gl.FRAGMENT_SHADER, fs_src));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error(`link: ${gl.getProgramInfoLog(p)}`);

    const loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
        const nm = gl.getActiveUniform(p, i).name;
        loc[nm] = gl.getUniformLocation(p, nm);
    }
    return { p, loc, a_pos: gl.getAttribLocation(p, "a_pos") };
};

/* RT 尺寸切分，照抄原版 CreateRenderTexture 的整除（HANDOFF §3.1 / §7-3）：
   /8 = mask 那几对 RT + composedEnabled/composedDisabled、/4 = effectRT + glow ping
   （反汇编里 v38 = 2*(w>>3)，就是 w/4）、/6 = sceneColorRT（apply 的 hue 源）。
   下限 1 是防窗口小于一个 RT 时分配出 0 尺寸（原版会直接创建失败）。 */
const rt_dim = (n, d) => Math.max(1, Math.floor(n / d));

const fx_init = () => {
    const canvas = document.createElement("canvas");
    const opts = {
        alpha: false, depth: false, stencil: false, antialias: false,
        premultipliedAlpha: false, preserveDrawingBuffer: true
    };
    const gl2 = canvas.getContext("webgl2", opts);
    const gl: any = gl2 || canvas.getContext("webgl", opts);
    if (!gl) return null;

    /* 异象 shader 的可选能力探测：
       has_texpack —— GlitchDog 的 _WireNoiseArray 是 sampler2DArray，
                      ES 3.00（WebGL2）才有；ES 1.00 里没这个类型，
                      所以拿不到 WebGL2 就整个 GlitchDog program 都不编译。
       has_deriv   —— DimensionSlash 需要屏幕空间导数。
                      ★ ES 3.00 里 dFdx/dFdy 是**内建**的（不需要扩展，
                        在 ES 3.00 上下文里 getExtension 反而返回 false）；
                      ES 1.00 才需要 OES_standard_derivatives。 */
    const has_texpack = !!gl2;
    const has_deriv = has_texpack || !!gl.getExtension("OES_standard_derivatives");
    const glsl_defs = has_deriv ? ["FX_HAS_DERIV"] : [];

    const mk_tex = (repeat?: boolean | 'mirror', nearest?: boolean) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        const filter = nearest ? gl.NEAREST : gl.LINEAR;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        const wrap = repeat === 'mirror' ? gl.MIRRORED_REPEAT : repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        return t;
    };

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const F = {
        gl, canvas, vbo,
        tex: [mk_tex(), mk_tex()],
        background: [mk_tex(), mk_tex()],
        // glitch 噪声图：Point + Repeat，对齐 Glitch4in1.png 的导入设置
        noise: mk_tex(true, true),
        /* 方块管线中间 RT 的分辨率与滤波全部照抄原版（HANDOFF §3.1、§7-3）：
             mask/sub  = w/8 Point —— 原版那几对 mask RT（0xC0/0xC8/0xD0/0xD8/0xE0/0xE8）
                         全是 w/8、R8/RG16、FilterMode 0(Point)，实际尺寸由每帧从 canvas
                         上传决定（canvas 已经是 /8，见 resize()）
             bcov      = w/8 Point —— composedEnabled/composedDisabled 同规格，
                         apply 里 covA 就是这么拿到「/8 阶梯」轮廓的
             bring     = w/4 **Bilinear** —— 原版 effectRT 是全场唯一一个 Bilinear（§8-7）
             scene6    = w/6 Point —— 原版 sceneColorRT（ARGB32 / Point），apply 的 hue 源 */
        mask: mk_tex(false, true), sub: mk_tex(false, true), subCount: mk_tex(false, true), bcov: mk_tex(false, true),
        bring: mk_tex(false, false),
        scene6: mk_tex(false, true),
        /* 位移图/火花图按原版贴图的导入设置采样：
           BlockNoise1.png  filterMode 0(Point) wrap 2(Repeat)
           PointNoise.png   filterMode 0(Point) wrap 0(Clamp)
           线性过滤会把 256² 的噪声抹平，方块边缘就变成平滑的扭动（扭曲），
           拿不到原版那种逐像素碎裂的边（细碎）。 */
        displace: mk_tex('mirror', true), spark: mk_tex(true, true),
        touchNoise: mk_tex('mirror', true), touchHover: mk_tex(false, false),
        /* 首玩异象的贴图。默认 1x1 白/黑占位，载入真实资源后覆盖。
           ★ wireNoise 必须用 gl.createTexture() 单独建 —— 它要绑到
             TEXTURE_2D_ARRAY 目标上传 2DArray，不能复用 mk_tex() 建的
             TEXTURE_2D 纹理（拿 2D 纹理绑 ARRAY 目标会 INVALID_OPERATION=1282）。 */
        glitchDogGlitchMap: mk_tex(false, false),
        glitchDogDisplace: mk_tex(false, false),
        wireNoise: (() => { const t = gl.createTexture(); return t; })(),
        kaleidoNormal: mk_tex(false, false),
        kaleidoTrans: mk_tex(false, false),
        /* VignettePlus 噪声 RT（原版 Renderer 每次 GetTemporary 的那张）：
           尺寸 = 画面 × noiseSampleRate（hate/Message 0.5 = 半分辨率），LINEAR+CLAMP
           （Unity 临时 RT 默认 Bilinear/Clamp）。懒分配：尺寸由 vignette 那趟按当前
           曲线的 noiseSampleRate 算（见 fx_render_anomaly），窗口变了自动重开。
           noise_w/h = 当前已分配尺寸（0 = 还没建过）。 */
        noiseRT: mk_tex(false, false),
        noise_w: 0, noise_h: 0,
        /* 分层渲染（异象）：fg = note 层画布上传的目标（背景层在 tex[0/1] 里 ping-pong，
           合成一趟 base+over 需要第三张纹理）；gridTex = DS 网格的 _MainTex(FrameBase_0)。
           ★ gridTex 必须 REPEAT（mk_tex(true,..)）：dsgrid.frag 按 _MainTex_ST=(10,10)
             平铺采样 uv∈[0,10]，且原版 FrameBase_0.png.meta 的 wrapU/wrapV=0（Repeat）。
             用 CLAMP 会把超出 [0,1] 的 ~90% 屏面钳采到贴图白色边框线 ⇒ 10×10 格子阵列
             变成整屏白灰雾（2026-10-05 同帧 A/B 实测，见 _analysis\anomaly_audit_20261005.md 补录）。 */
        fg: mk_tex(false, false),
        gridTex: mk_tex(true, false),
        fbo: gl.createFramebuffer(),
        w: 0, h: 0,
        caps: { has_texpack, has_deriv, is_gl2: !!gl2 },
        prog: {
            glitch: fx_program(gl, SH.glitch),
            rgbShift: fx_program(gl, SH.rgbShift),
            vignette: fx_program(gl, SH.vignette),
            vignetteNoise: fx_program(gl, SH.vignetteNoise),
            esc: fx_program(gl, SH.esc),
            copy: fx_program(gl, SH.copy),
            backgroundBlur: fx_program(gl, SH.backgroundBlur),
            bLayers: fx_program(gl, SH.block_layers),
            bCov: fx_program(gl, SH.block_cov),
            bRing: fx_program(gl, SH.block_ring),
            bApply: fx_program(gl, SH.block_apply),
            // 异象四个。glitchDog / dimSlash 是 ES 3.00（前者要 sampler2DArray，
            // 后者用内建 dFdx/bias），只在 WebGL2 上编译，配套 fx30_vs。
            // 没有 WebGL2 时它们是 null，fx_render_anomaly 会跳过该 pass。
            glitchDog: has_texpack ? fx_program(gl, SH.glitchDog, null, "fx30_vs") : null,
            dimSlash: has_texpack ? fx_program(gl, SH.dimSlash, null, "fx30_vs") : null,
            lightBand: fx_program(gl, SH.lightBand),
            kaleido: fx_program(gl, SH.kaleido),
            blendMask: fx_program(gl, SH.blendMask),
            dsGrid: fx_program(gl, SH.dsGrid),
            over: fx_program(gl, SH.overCompose),
            bloom: fx_program(gl, SH.bloom),
            lensDist: fx_program(gl, SH.lensDist)
        }
    };
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    return F;
};

// 绑贴图 + 把 sampler uniform 指到对应 unit
const fx_bind = (gl, unit, tex, loc?) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (loc) gl.uniform1i(loc, unit);
};

/* 绑 sampler2DArray（GlitchDog 的 _WireNoiseArray）。
   ★ 不能用 fx_bind：它硬编码 bindTexture(TEXTURE_2D)，而 array 纹理必须绑到
     TEXTURE_2D_ARRAY 目标，否则采样时 INVALID_OPERATION(1282)。 */
const fx_bind_array = (gl, unit, tex, loc?) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    if (loc) gl.uniform1i(loc, unit);
};

/* vp = 该 pass 要写的 RT 尺寸（不传就是全屏 F.w×F.h）。
   原版每个 pass 的 Blit 目标 RT 尺寸各不相同（/8 compose、/4 effectRT、/6 sceneColor），
   gl.viewport 必须跟着目标走，否则只会写到目标的左下角一块。 */
const fx_pass = (prog, dst_tex, setup?, vp?) => {
    const gl = C.fx.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst_tex ? C.fx.fbo : null);
    if (dst_tex) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst_tex, 0);
    gl.viewport(0, 0, vp ? vp[0] : C.fx.w, vp ? vp[1] : C.fx.h);

    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, C.fx.vbo);
    gl.enableVertexAttribArray(prog.a_pos);
    gl.vertexAttribPointer(prog.a_pos, 2, gl.FLOAT, false, 0, 0);

    if (setup) setup(prog, gl);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
};

/* 位移参数按 pass 分开喂：合成 mask 用 BlockCompose 那一套（决定轮廓怎么抖），
   全屏上色用 ActiveBlock/DisabledBlock 那一套（只用来取场景色和火花）。
   以前两个 pass 共用 ActiveBlock 的参数，等于拿 0.8/0.3 的噪声去扯轮廓，
   噪声被纵向拉长、幅度又放大 1.5 倍，方块就不是「边缘破碎」而是整块扭曲了。
   （§7-6 从 fx_blocks 内部闭包提到模块层：bLayers / bCov / bApply 三趟都要用。）
   strength = 该趟的 _DisplaceStrength；tx = t/20（Unity 的 _Time.x）由调用方传，
   因为 layers 那趟同样需要正确的时间相位。
   某趟 shader 没声明的 uniform（block_layers 没有 u_strength/u_stA/u_spA）location
   为 undefined，WebGL 静默忽略，不用特判。 */
const fx_disp_uniforms = (p, gl, A, D, strength, tx) => {
    const B = C.block;
    const F = C.fx;
    const dir = B.displaceDir;
    const dl = Math.hypot(dir[0], dir[1]) || 1;
    fx_bind(gl, 3, F.displace, p.loc.u_disp);
    // u_res 恒为**屏幕全分辨率**：block_disp 的网格量化是按 _ScreenParams（屏幕像素）
    // 算的，mask/compose 现在是 /8，但量化格子不能跟着除以 8（HANDOFF §7-3）。
    gl.uniform2f(p.loc.u_res, F.w, F.h);
    gl.uniform2f(p.loc.u_dir, dir[0] / dl, dir[1] / dl);
    gl.uniform1f(p.loc.u_ps, B.pixelScale);
    gl.uniform1f(p.loc.u_strength, strength);
    gl.uniform1f(p.loc.u_tx, tx);
    gl.uniform2f(p.loc.u_stA, A.displaceST[0], A.displaceST[1]);
    gl.uniform1f(p.loc.u_spA, A.displaceSpeed);
    gl.uniform2f(p.loc.u_stD, D.displaceST[0], D.displaceST[1]);
    gl.uniform1f(p.loc.u_spD, D.displaceSpeed);
};

/* §7-6：mask 上传 + compose → bcov（/8 Point）。layers 与 ring 都吃 bcov，
   所以这趟必须先跑；由 fx_render 的 block 分支编排顺序。 */
const fx_cov = t => {
    const F = C.fx;
    const gl = F.gl;
    const B = C.block;
    const vp8 = [rt_dim(F.w, 8), rt_dim(F.h, 8)];

    gl.bindTexture(gl.TEXTURE_2D, F.mask);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, C.block_cv);
    gl.bindTexture(gl.TEXTURE_2D, F.sub);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, C.block_sub_cv);
    gl.bindTexture(gl.TEXTURE_2D, F.subCount);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, C.block_sub_count_cv);

    fx_pass(F.prog.bCov, F.bcov, p => {
        fx_bind(gl, 0, F.mask, p.loc.u_mask);
        fx_bind(gl, 1, F.sub, p.loc.u_sub);
        fx_bind(gl, 2, F.subCount, p.loc.u_subCount);
        fx_disp_uniforms(p, gl, B.compose, B.compose, B.compose.displaceStrength, t / 20);
    }, vp8);
};

/* 方块管线后半段：ring（描边）-> apply（上色到场景）。
   mask 上传与 compose 已抽成 fx_cov()；disabled 加法层由 fx_render 里的 bLayers 趟跑。 */
const fx_blocks = (t, cur_tex, dst_tex) => {
    const F = C.fx;
    const gl = F.gl;
    const B = C.block;
    const w = F.w, h = F.h;
    // ring 趟写 /4（原版 effectRT）
    const vp4 = [rt_dim(w, 4), rt_dim(h, 4)];
    const tx = t / 20;   // Unity 的 _Time.x

    const common = p => fx_disp_uniforms(p, gl, B.active, B.disabled, B.displaceStrength, tx);

    const texel = [1 / vp4[0], 1 / vp4[1]];

    // 4.0.1.2 BlockRender.RenderEffects @1D71A00: edgeSize=1 -> EdgeMask pass1.
    // There is no GlowMask accumulation in this sample's type or native method.
    fx_pass(F.prog.bRing, F.bring, p => {
        fx_bind(gl, 0, F.bcov, p.loc.u_cov);
        gl.uniform2f(p.loc.u_texel, texel[0], texel[1]);
    }, vp4);

    fx_pass(F.prog.bApply, dst_tex, p => {
        const A = B.active, R = B.ready;
        fx_bind(gl, 0, cur_tex, p.loc.u_src);
        fx_bind(gl, 1, F.bcov, p.loc.u_cov);
        fx_bind(gl, 2, F.bring, p.loc.u_ring);
        fx_bind(gl, 4, F.spark, p.loc.u_spark);
        // hue 源 = /6 Point 快照（原版 sceneColorRT），已含 layers 烘进去的 disabled 层
        fx_bind(gl, 5, F.scene6, p.loc.u_scene6);
        fx_bind(gl, 6, F.touchNoise, p.loc.u_touchNoise);
        fx_bind(gl, 7, F.touchHover, p.loc.u_touchHover);
        const touchData = new Float32Array(40);
        blockFeedback.visible.forEach((touch, index) => {
            touchData.set([touch.x / w, 1 - touch.y / h, touch.scale, touch.active ? 1 : 0], index * 4);
        });
        gl.uniform4fv(p.loc['u_touches[0]'], touchData);
        gl.uniform1i(p.loc.u_touchCount, blockFeedback.visible.length);
        gl.uniform1f(p.loc.u_touchTime, performance.now() / 1000);
        common(p);
        // eA 格心 snap 的格子 = bring 的实际尺寸（原版 _EffectRT_TexelSize），别拿 u_assets/4 代
        gl.uniform2f(p.loc.u_ringRes, vp4[0], vp4[1]);
        gl.uniform1f(p.loc.u_ty, t);
        gl.uniform3f(p.loc.u_fillA, A.fillColor[0], A.fillColor[1], A.fillColor[2]);
        gl.uniform1f(p.loc.u_fillOpA, A.fillOpacity);
        gl.uniform1f(p.loc.u_fillStrA, A.fillStrength);
        gl.uniform3f(p.loc.u_edgeA, A.edgeColor[0], A.edgeColor[1], A.edgeColor[2]);
        gl.uniform1f(p.loc.u_edgeOpA, A.edgeOpacity);
        gl.uniform3f(p.loc.u_tintA, A.sparkTint[0], A.sparkTint[1], A.sparkTint[2]);
        gl.uniform1f(p.loc.u_sparkOpA, A.sparkOpacity);
        gl.uniform1f(p.loc.u_sparkDispA, A.sparkDisplace);
        gl.uniform1f(p.loc.u_hueA, A.sparkHueShift);
        gl.uniform2f(p.loc.u_sparkSTA, A.sparkST[0], A.sparkST[1]);
        gl.uniform1f(p.loc.u_dispBlendA, A.displaceBlend);
        // disabled 的填色/火花 uniform 已移到 bLayers 趟（§7-6），apply 不再画 disabled
        gl.uniform3f(p.loc.u_shineCol, R.shineColor[0], R.shineColor[1], R.shineColor[2]);
        gl.uniform1f(p.loc.u_shineBright, R.shineBrightness);
        gl.uniform1f(p.loc.u_shineSpeed, R.shineSpeed);
    });
};

/* 原版 Glitch 的三个位移方向与幅度全在顶点着色器里由 _Time/_CosTime 算出，与顶点位置无关，
   所以整屏共用同一组向量、每帧缓慢变化，而不是逐帧随机。逐行照抄 PostEffects_Glitch.glsl
   的顶点部分：先 fract(k*t+o) 取小数，再 (v+大常数)*(v+小常数) 平方后 fract 得到 [0,1) 伪随机；
   前两组各取两维归一化成 2D 方向（乘 _CosTime.w = cos t，只影响正负号），第三组直接当幅度。
   返回的每个 vec3 = (方向 x, 方向 y, 幅度)，直接喂给 u_dirA/B/C。 */
const glitch_dirs = t => {
    const fr = x => x - Math.floor(x);
    const hash = (v, big, small) => { const m = (v + big) * (v + small); return fr(m * m); };
    const dir2 = (x, y) => {
        const ct = Math.cos(t);
        const l = Math.hypot(x * ct, y * ct);
        return l > 1e-9 ? [(x * ct) / l, (y * ct) / l] : [0, 0];
    };
    const pair = (v0, v1) =>
        dir2(hash(v0, 33.5540237, 0.224023432), hash(v1, 33.80439, 0.474389642));

    const a0 = fr(0.1031 * t + 0.546), a1 = fr(0.1031 * t + 0.153);
    const a2 = fr(0.2062 * t + 0.546), a3 = fr(0.2062 * t + 0.153);
    const c0 = fr(0.3093 * t + 0.546), c1 = fr(0.3093 * t + 0.153);
    const c2 = fr(0.1031 * t + 0.1919), c3 = fr(0.2062 * t + 0.81);
    const r = fr(0.3093 * t + 0.1145);

    const A = pair(a0, a1), B = pair(a2, a3), C = pair(c0, c1);
    return {
        A: [A[0], A[1], hash(c2, 33.4939346, 0.16393432)],
        B: [B[0], B[1], hash(c3, 34.2789078, 0.948907495)],
        C: [C[0], C[1], hash(r, 34.0607834, 0.730783105)]
    };
};

/* ---------------- 首玩异象渲染 ----------------
   pass 顺序 = 运行时 postEffects 列表序 = *LevelEffects.Start() 里 AddEffect
   的调用序（2026-10-18 反编译核实：PostProcessingManager.AddEffects @0x1DAD898
   把效果追加到列表尾，OnRenderImage @0x1DBD01C 按列表序依次执行）。
   ★ 别再拿 prefab 的字段声明序当真（_analysis\postfx_pass_order.txt 记的是
     YAML 里的引用序，和 Start() 的调用序不同，此前端口就是按它排错的）：
     Hate    : Glitch -> RGBShift -> VignettePlus -> LensDistortion -> ColorBalance
     DS      : RGBShift -> Glitch -> GlitchDog -> LensDistortion -> Bloom -> DimensionSlash -> VignettePlus
     Message : Glitch -> ColorBalance -> LightBand -> Bloom -> VignettePlus -> LensDistortion
   其中 Hate 的 ColorBalance（ESC）排在 VignettePlus 之后是关键：contrast
   121.63 起 1.3、159.72 起 1.8 ⇒ 把 VP 抬起来的噪声暗部（max(col, noise*0.4)）
   又压回黑（(x-0.5)*1.8+0.5，x<0.222 直接归零），late 段屏幕上只剩稀疏细雪；
   端口此前把 colorBalance 排在 VP 前面，噪声没被压 —— 就是一整片亮雪花。
   各曲线的求值统一走上面的 director_eval（ease 表 / Hermite / clamp）。 */

/* GlitchDog：DS 的核心 pass。需要 displaceMap / glitchMap / wireNoise 三张图。 */
const fx_pass_glitchdog = (F, cur, eff, t, st) => {
    const g = F.gl;
    /* settings 里的向量是 Unity YAML 的字典：scale 系列 {x,y}、颜色 {r,g,b,a}。
       这里曾按数组 [0] 取 —— undefined 传进 uniform 就是 NaN，shader 里
       tint/uv 全变 NaN ⇒ fragColor 全黑 ⇒ DS 整屏黑。现在按字典取，
       同时兼容数组（万一以后手写 JSON 用数组）。 */
    const xy = (v, d) => (v && v.x !== undefined) ? [v.x, v.y] : (Array.isArray(v) ? v : d);
    const rgb = (v, d) => (v && v.r !== undefined) ? [v.r, v.g, v.b] : (Array.isArray(v) ? v : d);
    const cm = xy(st.glitchMapScale, [1, 1]);
    const ds = xy(st.displaceMapScale, [1, 1]);
    const ns = xy(st.noiseScale, [1, 1]);
    const no = xy(st.noiseOffset, [0, 0]);
    const dof = xy(st.displaceMapOffset, [0, 0]);
    const gmo = xy(st.glitchMapOffset, [0, 0]);
    const cc = rgb(st.centerColor, [0, 0, 0]);
    const ec = rgb(st.edgeColor, [0, 0, 0]);
    fx_pass(F.prog.glitchDog, F.tex[1 - cur], (p, gl) => {
        fx_bind(gl, 0, F.tex[cur], p.loc.u_src);
        fx_bind(gl, 1, F.glitchDogDisplace, p.loc.u_displaceMap);
        fx_bind(gl, 2, F.glitchDogGlitchMap, p.loc.u_glitchMap);
        if (F.caps.has_texpack) fx_bind_array(gl, 3, F.wireNoise, p.loc.u_wireNoise);
        gl.uniform4f(p.loc.u_time, t, t, 0, 0);
        gl.uniform2f(p.loc.u_noiseTexelSize,
                     F.noise_texel ? F.noise_texel[0] : 1, F.noise_texel ? F.noise_texel[1] : 1);
        gl.uniform1f(p.loc.u_noiseFrameCount, st.noiseFrameCount ?? 11);
        gl.uniform1f(p.loc.u_noiseMoveSpeed, st.noiseMoveSpeed ?? 0);
        gl.uniform1f(p.loc.u_noiseEvolveSpeed, st.noiseEvolveSpeed ?? 0);
        gl.uniform2f(p.loc.u_noiseScale, ns[0], ns[1]);
        gl.uniform2f(p.loc.u_noiseOffset, no[0], no[1]);
        gl.uniform1f(p.loc.u_seamBlend, st.seamBlend ?? 0.02);
        gl.uniform1f(p.loc.u_centerMaskRadius, st.centerMaskRadius ?? 0.094);
        gl.uniform1f(p.loc.u_centerMaskSmooth, st.centerMaskSmoothness ?? 0.07);
        gl.uniform1f(p.loc.u_edgeMaskRadius, st.edgeMaskRadius ?? 0.12);
        gl.uniform1f(p.loc.u_edgeMaskSmooth, st.edgeMaskSmoothness ?? 0.41);
        gl.uniform1f(p.loc.u_displaceStrength, st.displaceStrength ?? 0.2);
        gl.uniform2f(p.loc.u_displaceMapOffset, dof[0], dof[1]);
        gl.uniform2f(p.loc.u_displaceMapScale, ds[0], ds[1]);
        gl.uniform1f(p.loc.u_displaceSpeed, st.displaceSpeed ?? 1);
        gl.uniform1f(p.loc.u_glitchMapBright, st.glitchMapBrightness ?? 0);
        gl.uniform1f(p.loc.u_glitchMapContrast, st.glitchMapContrast ?? 3.5);
        gl.uniform2f(p.loc.u_glitchMapOffset, gmo[0], gmo[1]);
        gl.uniform2f(p.loc.u_glitchMapScale, cm[0], cm[1]);
        gl.uniform3f(p.loc.u_centerColor, cc[0], cc[1], cc[2]);
        gl.uniform3f(p.loc.u_edgeColor, ec[0], ec[1], ec[2]);
        gl.uniform1f(p.loc.u_colorBlend, st.colorBlend ?? 0.776);
    });
    return 1 - cur;
};

/* DimensionSlash：5 条切口。几何来自 slashes（取 time<=t 的最后一条）。 */
const fx_pass_dimslash = (F, cur, eff, t) => {
    const pos = new Float32Array(10), nrm = new Float32Array(10),
          off = new Float32Array(10), str = new Float32Array(5);
    let count = 0;
    const sl = eff.slashes || {};
    const order = Object.keys(sl).sort();
    for (const name of order) {
        const infos = sl[name] || [];
        let geo: { pos?: { x: number; y: number }; lineDir?: number; slashDir?: number } | null = null;
        for (const inf of infos) if (inf.time <= t) geo = inf; else break;
        const strength = eff_ev(eff, name + "Strength", t);
        if (!geo || strength <= 0) continue;
        // pos = (x, y, 0, 0)；normal = 由 lineDir 转的单位向量；offset = 由 slashDir
        pos[count * 2] = geo.pos ? geo.pos.x : 0;
        pos[count * 2 + 1] = geo.pos ? geo.pos.y : 0;
        nrm[count * 2] = Math.cos(geo.lineDir || 0);
        nrm[count * 2 + 1] = Math.sin(geo.lineDir || 0);
        off[count * 2] = Math.cos(geo.slashDir || 0);
        off[count * 2 + 1] = Math.sin(geo.slashDir || 0);
        str[count] = strength;
        count++;
        if (count >= 5) break;
    }
    const st = eff_settings(eff, "dimensionSlash", t) || {};
    const lc = st.slashLightColor || [1, 1, 1];
    fx_pass(F.prog.dimSlash, F.tex[1 - cur], (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        g.uniform2fv(p.loc.u_slashPos, pos);
        g.uniform2fv(p.loc.u_slashNormal, nrm);
        g.uniform2fv(p.loc.u_slashOffset, off);
        g.uniform1fv(p.loc.u_slashStrength, str);
        g.uniform1i(p.loc.u_slashCount, count);
        g.uniform1f(p.loc.u_lightStrength, st.slashLightStrength ?? 1);
        g.uniform1f(p.loc.u_lightFalloff, st.slashLightFalloff ?? 10);
        g.uniform3f(p.loc.u_lightColor, lc[0], lc[1], lc[2]);
    });
    return 1 - cur;
};

/* LightBand：Message 的反色光带（带内 ≈ 负片，bandWidth 0→1 = 反色区展开到全屏）。
   ★ bandNormal 不在 settings 里（LightBandSettings 只有 bandPos/bandDir/bandWidth/
     bandSmoothness/bandBrightness，见 dump.cs TypeDefIndex 4101），它是 SetMaterialData
     每帧写进材质的。原版实测（idalib 反编译，2026-10-06）：
       重载 SetMaterialData(mat) @0x1DBC658：aspect = width / height；
       私有 SetMaterialData(mat, aspect) @0x1DBC510：
         sincosf(angle = bandDir × 0.017453)   // ★ bandDir 是【度】不是弧度
                                                //   glibc/bionic: sincosf(x, sinp, cosp)
                                                //   sin → &a15+4，cos → &a15
         _BandPos    = (bandPos.x, bandPos.y)  // 不乘 aspect
         _BandNormal = (-sin(bandDir°) × aspect,  cos(bandDir°))   // dir 的【垂线】
     bandDir = 0° ⇒ 法线 = (0,1) ⇒ 光带是**横向**的，从中线向上/下展开。
     ⚠ 曾错写成 (cos,sin)（把带方向当成了法线 = 转 90°：竖带左右展开），
       且注释错标「弧度」、缺 aspect —— 2026-10-06 用户报「展开方向错了」后按反编译改正。 */
const fx_pass_lightband = (F, cur, eff, t) => {
    const st = eff_settings(eff, "lightBand", t) || {};
    const bp = st.bandPos || { x: 0.5, y: 0.5 };
    const rad = (st.bandDir ?? 0) * Math.PI / 180;   // 原版 bandDir 以度为单位
    const aspect = (F.w && F.h) ? F.w / F.h : 1;     // 原版 SetMaterialData(mat, w/h)
    fx_pass(F.prog.lightBand, F.tex[1 - cur], (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        g.uniform2f(p.loc.u_bandPos, bp.x, bp.y);
        g.uniform2f(p.loc.u_bandNormal, -Math.sin(rad) * aspect, Math.cos(rad));
        g.uniform1f(p.loc.u_bandWidth, st.bandWidth ?? 0);
        g.uniform1f(p.loc.u_bandSmooth, st.bandSmoothness ?? 0);
        g.uniform1f(p.loc.u_bandBright, st.bandBrightness ?? 1);
    });
    return 1 - cur;
};

/* KaleidoBlackMask：Message 的万花筒材质。mixStrength 由 kaleidoMix 曲线驱动。 */
const fx_pass_kaleido = (F, cur, eff, t) => {
    const mix = eff_ev(eff, "kaleidoMix", t);
    const st = eff.kaleido_static || {};
    const nst = st.normalST || [1, 1, 0, 0];
    const tst = st.transST || [1, 1, 0, 0];
    fx_pass(F.prog.kaleido, F.tex[1 - cur], (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        fx_bind(g, 1, F.kaleidoNormal, p.loc.u_normal);
        fx_bind(g, 2, F.kaleidoTrans, p.loc.u_transMap);
        g.uniform4f(p.loc.u_time, t, t, 0, 0);
        g.uniform2f(p.loc.u_normalST, nst[0], nst[1]);
        g.uniform2f(p.loc.u_normalSTOff, nst[2] || 0, nst[3] || 0);
        g.uniform2f(p.loc.u_transST, tst[0], tst[1]);
        g.uniform2f(p.loc.u_transSTOff, tst[2] || 0, tst[3] || 0);
        g.uniform1f(p.loc.u_normalStrength, st.normalStrength ?? 1);
        g.uniform2f(p.loc.u_normalMoveDir,
                    (st.normalMoveDir || [1, 0])[0], (st.normalMoveDir || [1, 0])[1]);
        g.uniform1f(p.loc.u_normalMoveSpeed, st.normalMoveSpeed ?? 0);
        g.uniform2f(p.loc.u_transMoveDir,
                    (st.transMoveDir || [1, 0])[0], (st.transMoveDir || [1, 0])[1]);
        g.uniform1f(p.loc.u_transMoveSpeed, st.transMoveSpeed ?? 0);
        g.uniform1f(p.loc.u_colorHueShift, st.colorHueShift ?? 0);
        g.uniform1f(p.loc.u_colorContrast, st.colorContrast ?? 1);
        g.uniform1f(p.loc.u_colorSaturation, st.colorSaturation ?? 1);
        g.uniform1f(p.loc.u_colorMixStrength, mix);
        g.uniform1f(p.loc.u_centerMaskRadius, st.centerMaskRadius ?? 0.5);
        g.uniform1f(p.loc.u_centerMaskSmooth, st.centerMaskSmoothness ?? 0.5);
    });
    return 1 - cur;
};

/* 统一约定：所有 fx_pass_* 助手返回「下一个可写的槽」。
   cur 是**当前画面所在的槽**，输出写到 F.tex[1-cur]，所以跑完一个 pass 后
   下一个可写槽就是 1-cur。被跳过的 pass（continue）不改变 cur。 */
const fx_pass_blackmask = (F, cur, eff, t) => {
    const it = (eff.imageTargets || []).find(x => x.target === "blackMask");
    if (!it) return cur;
    const a = eff_ev(eff, it.a_from, t);
    if (a <= 0) return cur;
    fx_pass(F.prog.blendMask, F.tex[1 - cur], (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        g.uniform4f(p.loc.u_rgba, it.rgb[0], it.rgb[1], it.rgb[2], a);
    });
    return 1 - cur;
};

/* Hidden/DsGrid：DS 背景网格，加法合成（Blend SrcAlpha/One，见 dsgrid.frag 头注释）。
   常数取自 DesultorySignals_Grid.mat；gridOpacity 曲线在 assets/effects/desultorysignals.json。
   freeze：原版在 nowTime>=freezeTime 时一次性 SetFloat(_GridScaleSpeed,0) 把脉冲定格；
   这里按状态谓词喂 0（与 glitchDog 的 freeze 谓词一致，往回 seek 自动还原）。 */
const fx_pass_grid = (F, cur, eff, t) => {
    const a = eff_ev(eff, "gridOpacity", t);
    if (a <= 0) return cur;
    const ft = eff.scalars ? eff.scalars.freezeTime : null;
    const frozen = ft !== null && ft !== undefined && t >= ft;
    fx_pass(F.prog.dsGrid, F.tex[1 - cur], (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        fx_bind(g, 1, F.gridTex, p.loc.u_mainTex);
        g.uniform2f(p.loc.u_mainTexST, 10, 10);
        g.uniform3f(p.loc.u_gridColor, 0.8066038, 0.990657, 1);
        g.uniform3f(p.loc.u_bloomColor, 0.514151, 0.5749958, 1);
        g.uniform1f(p.loc.u_gridBright, 0.57);
        g.uniform1f(p.loc.u_bloomBright, 0.59);
        g.uniform1f(p.loc.u_scaleSpeed, frozen ? 0 : 1);
        g.uniform1f(p.loc.u_time, t);
        g.uniform1f(p.loc.u_opacity, a);
    });
    return 1 - cur;
};

/* 背景层效果：黑幕 → kaleido → 网格。
   ★ 原版这三样全挂在 effect Canvas（SortingLayer=Background、ScreenSpaceCamera）
     的 Image 上，画在判定线/note **之下**（层级见 _analysis\_hier_dump.txt：
     Message/Hate 只有 BlackMask 一个孩子、DS 只有 Grid）——
     所以它们必须作用在「只有曲绘的背景画布」上，再把 note 层盖回来，
     而不是糊在整个已合成的帧上（否则 Message bgAlpha≡1 会把 note 一起染黑）。
   Message 的 BlackMask Image 挂着 kaleidoMat（kaleido 就是黑幕那一笔），
   bgAlpha≡1 时黑幕先铺黑、kaleido 再整幅替换成 outc*mask，合成结果与原版一致。 */
const fx_layer_bg = (F, cur, eff, t) => {
    cur = fx_pass_blackmask(F, cur, eff, t);
    if (eff.kaleido_static) cur = fx_pass_kaleido(F, cur, eff, t);
    if ((eff.imageTargets || []).some(x => x.target === "grid")) cur = fx_pass_grid(F, cur, eff, t);
    return cur;
};

/* 主调度：按 eff.order（= 运行时 postEffects 列表序，见文件头注释）依次跑。
   常规效果（glitch / rgbShift / vignette / esc）复用已有 shader，
   异象专有的四个走各自的移植版。
   ★ 黑幕/kaleido/网格不在这里跑 —— 它们属于背景层，在 fx_layer_bg 里
     （note 层合成之前）执行；它们本来也不在 postEffects 列表里，
     order 数组只有运行时效果链（message 里旧的 "kaleido" 条目已清掉）。 */
const fx_render_anomaly = (F, cur, eff, t) => {
    const gl = F.gl;
    const S = eff.settings;

    // 黑幕以前在这里整帧糊一刀（bgAlpha≡1 的 Message 会把 note 一起染黑）；
    // 现在挪进 fx_layer_bg，在 note 层合成之前作用于背景画布。

    // 每首的顺序来自 *_LevelEffects.prefab 的字段声明序（见文件头注释）
    const order = eff.order;
    for (const obj of order) {
        /* glitchDog / dimSlash 是 ES 3.00 shader，无 WebGL2 时没编译出来
           （program 为 null），整条 pass 跳过，其余照常跑。 */
        const pj = F.prog[{ glitchDog: "glitchDog", dimSlash: "dimSlash" }[obj]];
        if ((obj === "glitchDog" || obj === "dimensionSlash") && !pj) continue;
        switch (obj) {
            case "glitch": {
                const st = eff_settings(eff, "glitch", t) || {};
                const range = st.glitchRange ?? 0;
                if (range <= 0) continue;
                const gd = glitch_dirs(t);
                fx_pass(F.prog.glitch, F.tex[1 - cur], (p, g) => {
                    fx_bind(g, 0, F.tex[cur], p.loc.u_src);
                    fx_bind(g, 1, F.noise, p.loc.u_noise);
                    g.uniform1f(p.loc.u_range, range);
                    g.uniform3f(p.loc.u_dirA, gd.A[0], gd.A[1], gd.A[2]);
                    g.uniform3f(p.loc.u_dirB, gd.B[0], gd.B[1], gd.B[2]);
                    g.uniform3f(p.loc.u_dirC, gd.C[0], gd.C[1], gd.C[2]);
                });
                cur = 1 - cur;
                break;
            }
            case "rgbShift": {
                const st = eff_settings(eff, "rgbShift", t) || {};
                const c = st.center || { x: 0.5, y: 0.5 };   // Unity YAML 是 {x:,y:}
                fx_pass(F.prog.rgbShift, F.tex[1 - cur], (p, g) => {
                    fx_bind(g, 0, F.tex[cur], p.loc.u_src);
                    g.uniform1f(p.loc.u_radius, st.radius ?? 0);
                    g.uniform1f(p.loc.u_deform, st.screenDeform ?? 0.45);
                    g.uniform2f(p.loc.u_center, c.x, c.y);
                });
                cur = 1 - cur;
                break;
            }
            case "vignettePlus": {
                const st = eff_settings(eff, "vignettePlus", t) || {};
                const c = st.center || { x: 0.5, y: 0.5 };
                /* 噪声先烘：原版 Renderer 在 noiseBrightness>0 时每次
                   GetTemporary((int)(w*rate), (int)(h*rate)) → blit 生成趟 → blit 应用趟。
                   幅度（×_NoiseBrightness/_NoiseSaturation）烘在 RT 里，应用趟只当它开关。 */
                const nb = st.noiseBrightness ?? 0;
                if (nb > 0) {
                    const rate = st.noiseSampleRate ?? 0.5;
                    const nw = Math.max(1, Math.floor(F.w * rate));
                    const nh = Math.max(1, Math.floor(F.h * rate));
                    if (F.noise_w !== nw || F.noise_h !== nh) {
                        gl.bindTexture(gl.TEXTURE_2D, F.noiseRT);
                        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nw, nh, 0,
                                      gl.RGBA, gl.UNSIGNED_BYTE, null);
                        F.noise_w = nw; F.noise_h = nh;
                    }
                    fx_pass(F.prog.vignetteNoise, F.noiseRT, (p, g) => {
                        g.uniform1f(p.loc.u_time, t);
                        g.uniform1f(p.loc.u_noiseBright, nb);
                        g.uniform1f(p.loc.u_noiseSat, st.noiseSaturation ?? 1);
                    }, [nw, nh]);
                }
                /* 应用趟：噪声+扫描线（曲线驱动 noiseBrightness/lineOpacity，
                   hate 全程 0.36→0.8→1.5 / 0.02→0.1）。
                   late 段链尾还有 ESC（contrast 1.3→1.8）会把这层噪声压回黑，
                   hate 的 order 里 colorBalance 排在 vignettePlus 之后，别调换。 */
                fx_pass(F.prog.vignette, F.tex[1 - cur], (p, g) => {
                    fx_bind(g, 0, F.tex[cur], p.loc.u_src);
                    fx_bind(g, 1, F.noiseRT, p.loc.u_noiseTex);
                    g.uniform1f(p.loc.u_radius, st.radius ?? 1);
                    g.uniform1f(p.loc.u_smooth, st.smoothness ?? 1);
                    g.uniform1f(p.loc.u_darkness, st.darkness ?? 1);
                    g.uniform2f(p.loc.u_center, c.x, c.y);
                    g.uniform1f(p.loc.u_noiseBright, nb);
                    g.uniform1f(p.loc.u_lineOpacity, st.lineOpacity ?? 0);
                });
                cur = 1 - cur;
                break;
            }
            case "colorBalance": {
                const st = eff_settings(eff, "colorBalance", t) || {};
                /* ESC（Exposure_Saturate_ContrastSettings）三条：
                   rgb = avg + contrast * (satMix - avg)，再乘 brightness。
                   avg 是 settings.averageColor（prefab 静值 0.5,0.5,0.5）——
                   以前端口硬传 (0,0,0)，contrast>1 时支点错到 0 ⇒ 暗场整体提亮、
                   高光更容易削顶（hate 165.5 的中央光柱被推成纯白即此因）。 */
                const av = st.averageColor || { r: 0.5, g: 0.5, b: 0.5 };
                fx_pass(F.prog.esc, F.tex[1 - cur], (p, g) => {
                    fx_bind(g, 0, F.tex[cur], p.loc.u_src);
                    g.uniform1f(p.loc.u_brightness, st.brightness ?? 1);
                    g.uniform1f(p.loc.u_saturation, st.saturation ?? 1);
                    g.uniform1f(p.loc.u_contrast, st.contrast ?? 1);
                    g.uniform3f(p.loc.u_average, av.r, av.g, av.b);
                });
                cur = 1 - cur;
                break;
            }
            case "lensDistortion": {
                const st = eff_settings(eff, "lensDistortion", t) || {};
                const c = st.center || { x: 0.5, y: 0.5 };
                const conv = st.convergence ?? 0;
                if (conv === 0) continue;          // 无畸变就别占一趟
                /* ★ 2026-10-18：C# 绑定侧对 _Size/_Convergence 各乘 0.01
                   （LensDistortionSettings.SetMaterialData(mat, aspect) @0x1DBBE94：
                     LDR S9,[0xC3477C]（= 0x3C23D70A = 0.01f）→ FMUL size×S9 → SetFloat(_Size)；
                     同常量再 FMUL convergence —— edgeSmoothness/aspect 直传）。
                   之前拿资产原值 80/−8 直接绑：r = dist/(60)·… 畸变项 8r² ~ 1e-3，
                   整趟退化成「贴边 2.5% 淡出」，视频里那条又宽又硬的鱼眼黑框根本出不来。
                   缩放后 _Size=0.8、_Conv=−0.08 ⇒ 采样坐标外移 k=1+0.08r²，可见画面收进
                   中央 ~91%，四边出现 ~4.5%（L/R）/ ~3%（T/B）黑框 + 外圈可见压缩畸变，
                   与视频 v198 实测（L 0.0451 / T 0.0315）逐点吻合。 */
                const aspect = st.useScreenAspect
                    ? (F.w / Math.max(1, F.h))
                    : (st.manualAspect ?? 1);
                fx_pass(F.prog.lensDist, F.tex[1 - cur], (p, g) => {
                    fx_bind(g, 0, F.tex[cur], p.loc.u_src);
                    g.uniform2f(p.loc.u_center, c.x, c.y);
                    g.uniform1f(p.loc.u_size, (st.size ?? 100) * 0.01);
                    g.uniform1f(p.loc.u_convergence, conv * 0.01);
                    g.uniform1f(p.loc.u_aspect, aspect);
                    g.uniform1f(p.loc.u_edgeSmooth, st.edgeSmoothness ?? 0.025);
                });
                cur = 1 - cur;
                break;
            }
            case "bloom": {
                const st = eff_settings(eff, "bloom", t) || {};
                const bc = st.bloomColor || { r: 1, g: 1, b: 1 };
                // ★ 被 bloomBrightness 曲线驱动的是 brightness，不是 intensity。
                //   intensity 是静态的全局系数（DS 1.85 / Message 1.61）。
                const bright = st.brightness ?? 1;
                const inten = (st.intensity ?? 1) * bright;
                if (inten <= 0) continue;
                fx_pass(F.prog.bloom, F.tex[1 - cur], (p, g) => {
                    fx_bind(g, 0, F.tex[cur], p.loc.u_src);
                    // u_blurred 复用 u_src（bloom.frag 内部自己做阈值+模糊）
                    fx_bind(g, 1, F.tex[cur], p.loc.u_blurred);
                    g.uniform1f(p.loc.u_intensity, inten);
                    g.uniform3f(p.loc.u_bloomColor, bc.r, bc.g, bc.b);
                    g.uniform2f(p.loc.u_texel, 1 / Math.max(1, F.w), 1 / Math.max(1, F.h));
                    g.uniform1f(p.loc.u_threshold, st.threshold ?? 0.3);
                });
                cur = 1 - cur;
                break;
            }
            case "glitchDog": {
                const st = eff_settings(eff, "glitchDog", t) || {};
                /* DS 的 freeze（2026-10-17 字节级复核后重写，见 _analysis\anomaly_audit_20261017.md）：
                   原版在 nowTime >= freezeTime 时跑一次冻结块（freezed 闩锁 @+0x17C，位于所有
                   director 求值之后），写五个字段 ——
                     · noiseMoveSpeed=0 / noiseEvolveSpeed=0 / displaceSpeed=0.0：这三个没有曲线
                       驱动，写一次后原版永久生效 ⇒ 端口用状态谓词每帧覆写来等效（往回拖可还原）；
                     · glitchMapBrightness=1.6（0x3FCCCCCD）/ glitchMapContrast=3.5（0x40600000）：
                       下一帧就被 AnimationDirector 曲线覆回（brightness 1.5 → 147.98 起 1.6/0
                       闪烁、contrast 0.5 → 146.99 起 3.5）⇒ 只在冻帧当帧 snap，不持续覆写。
                   旧注释引用的 _sample_focus.txt「0.4/0/4」是 resolve_effect_params.py 的硬编码
                   误读（真值 0.0/1.6/3.5），源头（报告 §3.2 / resolve / main.js）已一并修正。 */
                const ft = eff.scalars ? eff.scalars.freezeTime : null;
                const active = ft !== null && ft !== undefined && t >= ft;
                if (active) {
                    st.noiseMoveSpeed = 0;
                    st.noiseEvolveSpeed = 0;
                    st.displaceSpeed = 0;
                    if (!eff._frozen) {          // 冻帧当帧：复刻原版那一帧的 1.6 / 3.5
                        st.glitchMapBrightness = 1.6;
                        st.glitchMapContrast = 3.5;
                    }
                }
                eff._frozen = active;
                cur = fx_pass_glitchdog(F, cur, eff, t, st);
                break;
            }
            case "dimensionSlash":
                cur = fx_pass_dimslash(F, cur, eff, t);
                break;
            case "lightBand":
                cur = fx_pass_lightband(F, cur, eff, t);
                break;
            // case "kaleido" 不在这里：万花筒是背景层的黑幕材质（fx_layer_bg）
        }
    }
    return cur;
};

const fx_render = (src_canvas, t, bg_canvas) => {
    const F = C.fx;
    const gl = F.gl;
    const pf = C.postfx_enabled ? C.postfx : null;
    const K = pf ? pf.curves : null;

    const eff = C.postfx_enabled ? C.fx_eff : null;
    /* 分层模式（F5 后：异象 **或** 带方块的谱）：bg_canvas=只有曲绘的背景画布，
       src_canvas=判定线+note 层。背景层先入 tex[0] 走 disabled/黑幕/kaleido/网格，
       再把 note 层 alpha-over 合回来 —— disabled 因此回到 note/线之下
       （原版 BackCanvas B/2 层序，audit F5，2026-10-06 修复）。
       无 bg_canvas（非异象且无方块 / fx 不可用）照旧整帧入 tex[0]。 */
    const split = !!bg_canvas;

    gl.bindTexture(gl.TEXTURE_2D, F.tex[0]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE,
                  split ? bg_canvas : src_canvas);

    let cur = 0;
    const run = (prog, setup) => {
        fx_pass(prog, F.tex[1 - cur], setup);
        cur = 1 - cur;
    };

    // ① disabled/ready 方块先压进背景场景（HANDOFF §10.1：compose → layers）。
    //    fx_cov 只吃 canvas mask（block_cv/block_sub_cv，render_scene 里画的），与层序无关；
    //    bLayers 把 disabled 填色烘进 tex —— 在异象分层里它必须在黑幕/kaleido/网格**之前**，
    //    对应原版 BackCanvas(B/2) 在 effect Canvas(B/3) 之下（audit §2.1 层序）。
    //    ★ active 方块（fx_blocks）不在这里跑：原版走主相机 CameraEvent=18（BeforeImageEffects），
    //      快照 = 已含黑幕+判定线+note 的整帧，压在全部之上（audit F1，2026-10-06 修复）。
    //      split 模式（异象或普通方块谱）下它挪到 fg 合成之后（eff 分支 ④ / 下面 F5 分支）；
    //      非 split 只剩「无方块或 fx 不可用」—— tex[0] 本身就是含 note 的整帧。
    if (C.block_live) {
        const tx = t / 20;
        const D = C.block.disabled;

        fx_cov(t);

        fx_pass(F.prog.bLayers, F.tex[1 - cur], p => {
            fx_bind(gl, 0, F.tex[cur], p.loc.u_src);
            fx_bind(gl, 1, F.bcov, p.loc.u_cov);
            fx_bind(gl, 4, F.spark, p.loc.u_spark);
            // layers 无位移强度（DisabledBlock 场景色不位移），snap=0 见 block_layers.frag
            fx_disp_uniforms(p, gl, D, D, 0, tx);
            gl.uniform3f(p.loc.u_fillD, D.fillColor[0], D.fillColor[1], D.fillColor[2]);
            gl.uniform1f(p.loc.u_fillOpD, D.fillOpacity);
            gl.uniform3f(p.loc.u_tintD, D.sparkTint[0], D.sparkTint[1], D.sparkTint[2]);
            gl.uniform1f(p.loc.u_sparkOpD, D.sparkOpacity);
            gl.uniform1f(p.loc.u_sparkDispD, D.sparkDisplace);
            gl.uniform2f(p.loc.u_sparkSTD, D.sparkST[0], D.sparkST[1]);
        });
        cur = 1 - cur;

        // 非分层路径（bg_canvas=null）：快照 + active 在这里（原顺序）；
        // split 路径（异象或普通方块谱）挪到 fg 合成之后（eff 分支 ④ / 下面 F5 分支）。
        if (!bg_canvas) {
            const vp6 = [rt_dim(F.w, 6), rt_dim(F.h, 6)];   // 必须与 apply_postfx 的 set(scene6) 同表达式
            fx_pass(F.prog.copy, F.scene6, (p, g) => fx_bind(g, 0, F.tex[cur], p.loc.u_src), vp6);
            fx_blocks(t, F.tex[cur], F.tex[1 - cur]);
            cur = 1 - cur;
        }
    }

    /* 首玩异象（Chapter9 baseline 的 LevelEffects）走独立分支：
       pass 顺序 = prefab 里settings 字段的声明顺序，各曲线用 director_eval。
       ★ fx_render_anomaly 沿用 run() 的约定：画面始终在 tex[cur]。 */
    if (eff) {
        if (split) {
            // ① 背景层效果（黑幕/kaleido/网格）—— 作用在曲绘+disabled 方块上，note 还没进来
            cur = fx_layer_bg(F, cur, eff, t);
            // ② 判定线+note 层盖回来（新建的 alpha-over 一趟）
            gl.bindTexture(gl.TEXTURE_2D, F.fg);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src_canvas);
            fx_pass(F.prog.over, F.tex[1 - cur], (p, g) => {
                fx_bind(g, 0, F.tex[cur], p.loc.u_base);
                fx_bind(g, 1, F.fg, p.loc.u_over);
            });
            cur = 1 - cur;
            // ④ active 方块 = 原版 CameraEvent 18：对含【曲绘+disabled+黑幕/kaleido/网格+线+note】
            //    的整帧快照做合成，压在全部之上（fix audit F1：之前垫底 ⇒ Message 黑幕≡1 时
            //    方块整曲被吞、DS 前 65s 被 0.8 黑幕压暗 80%）。scene6 快照同步后移，
            //    apply 的 hue 源因此含 note/黑幕（audit §2.3 第 2 行「内容缺失」一并修正）。
            if (C.block_live) {
                const vp6 = [rt_dim(F.w, 6), rt_dim(F.h, 6)];
                fx_pass(F.prog.copy, F.scene6, (p, g) => fx_bind(g, 0, F.tex[cur], p.loc.u_src), vp6);
                fx_blocks(t, F.tex[cur], F.tex[1 - cur]);
                cur = 1 - cur;
            }
        }
        // ③ 整帧后处理链（lightBand/glitch/... 照旧跑在合成后的画面上）
        cur = fx_render_anomaly(F, cur, eff, t);
        /* 约定与 run()/下面非异象分支一致：每次 pass 写 tex[1-cur] 后 cur = 1-cur，
           所以返回时画面在 tex[cur]，copy 必须读 tex[cur]。
           之前读 1-cur：0 个 pass 时读到上一帧残留（整屏黑），
           有 pass 时则永远丢掉最后一趟效果。 */
        fx_pass(F.prog.copy, null, (p, g) => fx_bind(g, 0, F.tex[cur], p.loc.u_src));
        return;
    }

    /* F5（audit 2026-10-06 修复）：非异象但走分层的谱（普通方块谱）——
       ① 判定线+note 层 alpha-over 盖回「曲绘+disabled」之上；
       ② scene6 快照 + active 方块压在最上（与 eff split 分支 ④ 同序：
          原版 active 走 CameraEvent=BeforeImageEffects，快照含 note/线）。 */
    if (split) {
        gl.bindTexture(gl.TEXTURE_2D, F.fg);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src_canvas);
        fx_pass(F.prog.over, F.tex[1 - cur], (p, g) => {
            fx_bind(g, 0, F.tex[cur], p.loc.u_base);
            fx_bind(g, 1, F.fg, p.loc.u_over);
        });
        cur = 1 - cur;
        if (C.block_live) {
            const vp6 = [rt_dim(F.w, 6), rt_dim(F.h, 6)];
            fx_pass(F.prog.copy, F.scene6, (p, g) => fx_bind(g, 0, F.tex[cur], p.loc.u_src), vp6);
            fx_blocks(t, F.tex[cur], F.tex[1 - cur]);
            cur = 1 - cur;
        }
    }

    if (!pf) {
        fx_pass(F.prog.copy, null, (p, g) => fx_bind(g, 0, F.tex[cur], p.loc.u_src));
        return;
    }

    const gr = curve_val(K.glitchRange, t);
    const gd = glitch_dirs(t);
    run(F.prog.glitch, (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        fx_bind(g, 1, F.noise, p.loc.u_noise);
        g.uniform1f(p.loc.u_range, gr);
        g.uniform3f(p.loc.u_dirA, gd.A[0], gd.A[1], gd.A[2]);
        g.uniform3f(p.loc.u_dirB, gd.B[0], gd.B[1], gd.B[2]);
        g.uniform3f(p.loc.u_dirC, gd.C[0], gd.C[1], gd.C[2]);
    });

    const cc = pf._constants || {};
    run(F.prog.rgbShift, (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        g.uniform1f(p.loc.u_radius, curve_val(K.rgbShiftRadius, t));
        g.uniform1f(p.loc.u_deform, curve_val(K.rgbShiftDeform, t));
        g.uniform2f(p.loc.u_center, cc.rgbShiftCenter[0], cc.rgbShiftCenter[1]);
    });

    run(F.prog.vignette, (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        fx_bind(g, 1, F.noiseRT, p.loc.u_noiseTex);
        g.uniform1f(p.loc.u_radius, curve_val(K.vignetteRadius, t));
        g.uniform1f(p.loc.u_smooth, curve_val(K.vignetteSmoothness, t));
        g.uniform1f(p.loc.u_darkness, curve_val(K.vignetteDarkness, t));
        g.uniform2f(p.loc.u_center, cc.vignetteCenter[0], cc.vignetteCenter[1]);
        /* 非异象谱不开噪声/扫描线（postfx.json 里也没有这组曲线；noiseRT 不会被采样）。 */
        g.uniform1f(p.loc.u_noiseBright, 0);
        g.uniform1f(p.loc.u_lineOpacity, 0);
    });

    run(F.prog.esc, (p, g) => {
        fx_bind(g, 0, F.tex[cur], p.loc.u_src);
        g.uniform1f(p.loc.u_brightness, curve_val(K.brightness, t));
        g.uniform1f(p.loc.u_saturation, cc.saturation);
        g.uniform1f(p.loc.u_contrast, cc.contrast);
        g.uniform3f(p.loc.u_average, 0, 0, 0);
    });

    fx_pass(F.prog.copy, null, (p, g) => fx_bind(g, 0, F.tex[cur], p.loc.u_src));
};

const apply_postfx = (src, dst, t, bg) => {
    const dctx = dst.getContext("2d");
    const w = dst.width, h = dst.height;

    // 视口可能瞬时为 0（隐藏 / 最小化）。这时候不能往下走：GL canvas 会被缩到 0x0，
    // 之后 drawImage 直接抛 InvalidStateError。
    if (!w || !h) return;

    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.globalAlpha = 1;
    dctx.globalCompositeOperation = "source-over";
    dctx.clearRect(0, 0, w, h);

    /* 分层降级：WebGL 用不了时 src 只有 note 层，必须先把背景画布垫上，
       否则黑屏（两层是 render() 分开画的）。 */
    const flat = () => {
        if (bg) dctx.drawImage(bg, 0, 0);
        dctx.drawImage(src, 0, 0);
    };

    // Blocks are scene content. Their WebGL materials remain active when post-processing is disabled.
    if (C.fx_failed || (!C.postfx_enabled && !C.chart.blocks?.length)) {
        flat();
        return;
    }

    if (!C.fx) {
        try {
            C.fx = fx_init();
        } catch (e) {
            C.fx = null;
            console.error("WebGL 管线初始化失败，退回原图：", e);
        }
        if (!C.fx) {
            C.fx_failed = true;
            flat();
            return;
        }
        // glitch / 方块噪声上传都已移出首建分支 → 统一走下面的守卫式上传
        // （audit F2：首建分支对「异象先建 C.fx」「切谱换 glitchTex」都不执行/不重传；
        //   2026-10-17：方块的 displace/spark 同款漏传 —— 位移变恒定偏移、火花点全灭）
    }

    const gl = C.fx.gl;
    /* F2：噪声图守卫式上传 —— 按 img 身份比对，换谱/异象互切自动重传；
       异象谱 C.glitch_img=null 时这里不动（glitch4in1 由 fx_load_anomaly 上传）。 */
    fx_upload_noise(C.fx, C.glitch_img);
    fx_upload_block(C.fx);
    if (C.fx.w !== w || C.fx.h !== h) {
        C.fx.w = w;
        C.fx.h = h;
        C.fx.canvas.width = w;
        C.fx.canvas.height = h;
        // 中间 RT 按各自分辨率重建（mask/sub 由 canvas 上传决定，不在这儿管）。
        // 窗口一改尺寸这些全要重分，否则 viewport 和纹理尺寸对不上 → 花屏/黑屏。
        const set = (tex, tw, th) => {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        };
        set(C.fx.tex[0], w, h);
        set(C.fx.tex[1], w, h);
        set(C.fx.bcov, rt_dim(w, 8), rt_dim(h, 8));
        set(C.fx.bring, rt_dim(w, 4), rt_dim(h, 4));
        set(C.fx.scene6, rt_dim(w, 6), rt_dim(h, 6));
    }

    fx_render(src, t, bg);
    dctx.drawImage(C.fx.canvas, 0, 0);
};

/* ---------------- 画布尺寸 ----------------
   所有渲染尺寸都从这两个函数走：resize_canvases 是唯一入口，
   resize_to_window 跟窗口走（onresize 与视频导出结束时都回到它）。
   视频导出期间会临时把画布切到导出分辨率（w×h 与 w/8 的方块 mask 画布）。 */
const resize_canvases = (w, h) => {
    cv.width = w;
    cv.height = h;
    C.scene_cv.width = w;
    C.scene_cv.height = h;
    C.bg_cv.width = w;
    C.bg_cv.height = h;
    // 方块 mask 按原版 RT 尺寸 w/8 × h/8 光栅化（HANDOFF §3.1：那几对 mask RT 全是
    // w/8、Point，compose 也跑在 /8 上）。>> 3 就是原版 Start 里的 v31>>3 / v32>>3。
    C.block_cv.width = Math.max(1, w >> 3);
    C.block_cv.height = Math.max(1, h >> 3);
    C.block_sub_cv.width = C.block_cv.width;
    C.block_sub_cv.height = C.block_cv.height;
    C.block_sub_count_cv.width = C.block_cv.width;
    C.block_sub_count_cv.height = C.block_cv.height;
};

let screen_pixel_density = 0;
const resize_to_window = () => {
    // 导出期间画布是导出分辨率，窗口 onresize 不许把它覆盖掉
    if (C.video_export_active) return;
    const fullscreen = document.fullscreenElement === document.getElementById('stage');
    const width = fullscreen ? window.innerWidth : Math.max(1, Math.min(960, document.documentElement.clientWidth - 16));
    const height = fullscreen ? window.innerHeight : Math.round(width * 9 / 16);
    const density = window.devicePixelRatio || 1;
    screen_pixel_density = density;
    const pixels_w = Math.max(1, Math.round(width * density));
    const pixels_h = Math.max(1, Math.round(height * density));
    // CSS keeps the stage layout stable; the backing store uses physical pixels.
    cv.style.width = `${width}px`;
    cv.style.height = `${height}px`;
    if (cv.width !== pixels_w || cv.height !== pixels_h) resize_canvases(pixels_w, pixels_h);
};

/* ---------------- 主渲染 ---------------- */

const game_chart_viewport = () => chartViewport(cv.width, cv.height, resolveChartAspect(C.chart.data?.aspectRatio, settings?.chartAspectRatio));

/* mode: undefined=整帧（普通谱）| "bg"=只画曲绘（异象分层的背景画布）|
   "fg"=只画判定线/note/打击特效+方块 mask（透明底）。 */
const render_scene = (sctx, t, mode?, preview = false) => {
    if (!preview) C.openingPreview = null;
    const [w, h] = [cv.width, cv.height];
    const adapted = hasChartViewport(C.chart.data), viewport = game_chart_viewport();
    const objectScale = adapted ? viewport.gameplayScale : 1;
    const objectHeight = h * objectScale, objectWidth = adapted ? viewport.width : w;
    const note_width = h * (9.89 * 0.22 / 10) * (settings?.noteScale ?? 1) * (adapted ? objectScale : noteViewportScale(w, h));

    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalAlpha = 1;
    sctx.globalCompositeOperation = "source-over";
    sctx.clearRect(0, 0, w, h);
    if (mode !== "fg") {
        sctx.drawImage(game_background(w, h).canvas, 0, 0);
        // GameInformation默认背景亮度=.75，LevelStart动画末尾CanvasGroup.alpha=.7。
        // LevelInformation.Update把黑色Image.alpha设成1-背景亮度；两者相乘为.175。
        sctx.fillRectEx(0, 0, w, h, `rgba(0, 0, 0, ${1 - (settings?.brightness ?? 0.65)})`);
    }
    if (mode === "bg") return;   // 背景画布到此为止；前景在另一张画布上画
    sctx.save();
    if (adapted) { sctx.beginPath(); sctx.rect(viewport.left, 0, viewport.width, h); sctx.clip(); }

    // Bad copies are Background/3 at z=original+1, behind the judgement lines.
    if (!preview && !settings.autoplay && !C.video_export_active) {
        for (const effect of judge.badEffects) {
            const alpha = badNoteAlpha(effect.elapsed);
            if (!alpha) continue;
            const note = effect.note, line = note.master as any;
            const [rotation, x, y] = line.get_state(t);
            const frozenFloor = ((note.floorPosition ?? 0) - get_fp(line.sec2beat(effect.time), line.speedEvents)) *
                C.units.pgrh * (C.units.pgrbeat / line.bpm) * h * note.speed;
            const local = rotate_point(x * w, y * h, note.positionX * C.units.pgrw * objectWidth, rotation);
            const position = rotate_point(...local, frozenFloor, rotation - (note.is_above ? 90 : -90));
            const img = C.note_imgs.badTap;
            if (!img) continue;
            sctx.globalAlpha = alpha;
            sctx.drawCenterRotateImage(img, ...position, note_width, note_width / img.width * img.height,
                rotation + (note.is_above ? 0 : 180));
        }
        sctx.globalAlpha = 1;
    }
    const indicatorColor = judgeLineColor(settings.apFcIndicator ?? true,
        settings.autoplay || C.video_export_active ? { good: 0, bad: 0, miss: 0 } : (C.line_status ?? judge.stats));
    for (const line of C.chart.renderLines) {
        let [lineRotate, lineX, lineY, lineAlpha] = line.get_state(t);
        if (lineAlpha <= 0) continue;
        const appearance = lineAppearance(line, t);
        if (appearance.scaleX === 0 || appearance.scaleY === 0) continue;
        const kind = lineVisualKind(line);
        if (kind === 'text' && !appearance.text) continue;
        lineX *= w; lineY *= h;
        const textureName = kind === 'texture' ? line.animation?.texture : undefined;
        if (textureName) {
            const size = C.chart.textures?.dimensions(textureName);
            if (!size || !textureIsVisible(lineX, lineY, size.width, size.height,
                viewport.textureScale * appearance.scaleX, viewport.textureScale * appearance.scaleY,
                lineRotate, line.animation.anchor ?? [.5, .5], viewport.left, viewport.left + viewport.width, h)) continue;
        }

        sctx.save();
        sctx.globalAlpha = Math.max(0, Math.min(1, lineAlpha));
        if (kind === 'text') {
            sctx.translate(lineX, lineY); sctx.rotate(lineRotate * Math.PI / 180);
            sctx.scale(appearance.scaleX, appearance.scaleY);
            sctx.font = `${objectHeight * 60 / 900}px ${C.chart.fonts?.family(appearance.font) ?? 'PhiHUD, sans-serif'}`; sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
            sctx.fillStyle = appearance.color || '#ffffff';
            const rows = (appearance.text ?? '').split('\n');
            const textWidth = Math.max(...rows.map(text => sctx.measureText(text).width));
            const textHeight = rows.length * objectHeight * 72 / 900;
            const [ax, ay] = line.animation?.anchor ?? [.5, .5];
            rows.forEach((text, i) => sctx.fillText(text, (.5 - ax) * textWidth,
                (ay - .5) * textHeight + (i - (rows.length - 1) / 2) * objectHeight * 72 / 900));
        } else if (kind === 'texture') {
            const texture = C.chart.textures?.get(line.animation.texture, t, appearance.gifProgress, appearance.color, 'filter' in sctx,
                viewport.textureScale * Math.max(Math.abs(appearance.scaleX), Math.abs(appearance.scaleY)));
            if (texture) {
                const [ax, ay] = line.animation.anchor ?? [.5, .5];
                sctx.translate(lineX, lineY); sctx.rotate(lineRotate * Math.PI / 180);
                sctx.scale(viewport.textureScale * appearance.scaleX, viewport.textureScale * appearance.scaleY);
                if (texture.filter) sctx.filter = texture.filter;
                sctx.drawImage(texture.image, -ax * texture.width, (ay - 1) * texture.height, texture.width, texture.height);
            }
        } else {
            const size = C.chart.data.sourceFormat === 'rpe' ? rpeLineSize(viewport.textureScale, appearance.scaleX, appearance.scaleY)
                : { halfLength: objectHeight * C.lineh * appearance.scaleX, width: Math.abs(objectHeight * C.linew * appearance.scaleY) };
            sctx.drawLine(...rotate_point(lineX, lineY, size.halfLength, lineRotate),
                ...rotate_point(lineX, lineY, size.halfLength, lineRotate + 180), size.width, appearance.color || indicatorColor);
        }
        sctx.restore();
    }
    // All judgement lines precede all notes, including notes from other lines.
    for (const note of C.chart.renderNotes) {
        const line = note.master;
        let [lineRotate, lineX, lineY, lineAlpha] = line.get_state(t);
        if (line.animation && lineAlpha < 0) continue;
        lineX *= w; lineY *= h;
        const beatt = line.sec2beat(t);
        const linefp = get_fp(beatt, line.speedEvents);
            if (!preview && (settings.autoplay || C.video_export_active) && note.sect < t && !note.clicked) {
                // 视频导出时不发声：导出比实时快，实时播放的打击音必然错位
                // （导出的音轨只有音乐，见「视频导出」一节），clicked 标记照置。
                if (!note.isFake && !C.video_export_active && clock.running) play_sound(note_sound(note));
                note.clicked = true;
            }

            const result = judge.results.get(note);
            if (!noteIsVisible(note, result, t, settings.autoplay || C.video_export_active)) {
                continue;
            }

            // 可见性判定：游戏 NoteUpdateManager.Update 每帧对每个 note 的顺序是
            //   ① if (note.realTime < nowTime) goto 判定分支;        ← ★先判，note 已到点就走判定
            //   ② dist = note.floorPosition - linefp                  （★还没乘 note.speed）
            //      if (dist < -max(note.floorPosition/6e6, 0.001)) 跳过;
            // 也就是说 dist 那条**只在 note 还没到点时生效**。到点之后（hold 被点中、正在
            // 拉伸/回收 hold 体）走的是判定分支，hold 体必须继续画 —— 别在这里把 hold 体剔掉。
            // 「跳过」= 不定位、不画、不判定，note 对象永远停在创建时的 position=(1000,0,0)
            // 那个停放位上（CreateNote 里四种 type 都这么初始化），所以等于不可见。
            // 负流速（judgeLineSpeedEvent.value<0）时 linefp 往回走，dist 会在 note 自己到点
            // **之前**就变负 ⇒ 原版不显示，我们原先只判 < -1e6 所以把它画出来了。
            const dist = note.floorPosition - linefp;
            if (line.animation) {
                const tailDist = note.is_hold ? get_fp(note.time + note.holdTime, line.speedEvents) - linefp : dist;
                if (line.animation.cover && note.sect >= t && dist * note.speed < -0.001 && tailDist * note.speed < -0.001) continue;
            } else if (note.sect >= t && dist < -Math.max(note.floorPosition / 6000000, 0.001)) continue;

            // Scroll distances are height units. The viewport width controls
            // sprite size, but must not compress note spacing or Hold length.
            let note_fp = dist * C.units.pgrh * (C.units.pgrbeat / line.bpm) * h;

            if (!note.is_hold || line.animation) note_fp *= note.speed;
            if (!note.is_hold && note_fp < -1e6) continue;
            if (note_fp > h * 2 && !(note.is_hold && line.animation) && !line.animation?.controls?.y) continue;

            const offsetPixels = (note.yOffset ?? 0) * note.speed * C.units.pgrh * h;
            const activeHold = note.is_hold && t > note.sect && (!note.isFake || C.chart.data.sourceFormat === 'rpe');
            const controlDistance = (activeHold ? 0 : dist * C.units.pgrh * (C.units.pgrbeat / line.bpm) * 900) + (note.yOffset ?? 0) * 540;
            const geometry = line.animation ? chartNoteGeometry(note, line.animation, t, controlDistance, note.is_above) : undefined;
            const controlSize = geometry?.size ?? 1;

            const draw_head = note.is_hold ? !activeHold : !note.clicked;
            const note_head_img = C.note_head_imgs[note.type][note.morebets];
            const base_note_width = note_width * controlSize * (note.morebets ? (
                C.note_head_imgs[note.type][1].width
                / C.note_head_imgs[note.type][0].width
            ) : 1.0);
            const this_note_width = base_note_width * (note.size ?? 1);
            const this_note_head_height = base_note_width / note_head_img.width * note_head_img.height;
            const l2n_rotate = lineRotate - (note.is_above ? 90 : -90);
            const note_atline_pos = rotate_point(...rotate_point(lineX, lineY,
                geometry ? geometry.x * viewport.textureScale : note.positionX * C.units.pgrw * objectWidth, lineRotate),
                (note.yOffset ?? 0) * note.speed * C.units.pgrh * h, l2n_rotate);
            const note_head_pos = geometry ? rotate_point(...note_atline_pos, geometry.y / 900 * h - offsetPixels, l2n_rotate)
                : rotate_point(...note_atline_pos, note_fp, l2n_rotate);

            const note_draw_rotate = lineRotate + (note.is_above ? 0 : 180);

            sctx.save();
            if (line.animation?.cover && !note.is_hold) {
                const matrix = sctx.getTransform(), reach = Math.hypot(w, h) + Math.abs(lineX) + Math.abs(lineY);
                sctx.translate(lineX, lineY); sctx.rotate(lineRotate * Math.PI / 180);
                sctx.beginPath(); sctx.rect(-reach, note.is_above ? -reach : 0, reach * 2, reach); sctx.clip(); sctx.setTransform(matrix);
            }
            sctx.globalAlpha = Math.max(0, Math.min(1, (note.alpha ?? 1) * (geometry?.alpha ?? 1))) *
                (note.is_hold ? result?.visualMissed ? gameplayMetrics.holdMissAlpha : 1 : lateNoteAlpha(note, t));
            if (draw_head && !note.is_hold) {
                sctx.drawCenterRotateImage(
                    sprite_tints.get(note_head_img, note.tint), ...note_head_pos,
                    this_note_width, this_note_head_height,
                    note_draw_rotate, geometry?.skew ?? 0
                );
            }

            if (note.is_hold) {
                const note_body_img = C.hold_body_imgs[note.morebets];
                const note_tail_img = C.hold_tail_imgs[note.morebets];
                const note_tail_height = base_note_width / note_tail_img.width * note_tail_img.height;

                /* hold 体收缩量按【剩余时间】线性，不按 dist —— 原版 HoldControl::NoteMove
                   （@0x1D83314，2026-10-06 反编译）holding 分支直接写 SpriteRenderer 局部缩放：
                     y = note.speed × ((realTime + holdTime − nowTime) / 3.8 × 0.2) × LevelInformation.Speed
                   即「长度 ∝ 距 hold 结束的剩余秒数」，全程不读 floorPosition；
                   approach 分支（nowTime ≤ realTime）同式代入 remain=holdTime ⇒ 常量，点击瞬间严格连续。
                   旧实现用 min(0, note_fp) 按线的 floorPosition 消费：常规段（line 值 speed==note.speed）
                   两种算法等价看不出差别，但 999 冲刺（1 个128分音 value=999）会让 linefp 在 8ms 内
                   跳过整段 fp-span ⇒ 点击后 body 秒塌 = 「部分长条打击后就消失」
                   （Message SP t≈22.9/24.3/25.1 三处，各叠两条 note）；负流速段则反过来只缩不完。
                   修法：clicked 起用 (t−sect)/secht 线性收缩，未点击保持全长。 */
                const attached = activeHold;
                const span = line.animation ? chartHoldSpan(note.floorPosition, get_fp(note.time + note.holdTime, line.speedEvents), linefp, attached) : undefined;
                const hold_full = line.animation
                    ? (span![1] - span![0]) * C.units.pgrh * h * note.speed
                    : note.hold_length * h;
                const hold_shrink = attached && !line.animation
                    ? hold_full * Math.min(1, Math.max(0, (t - note.sect) / Math.max(note.secht, 1e-6)))
                    : 0;
                const holdDirection = line.animation && hold_full < 0 ? -1 : 1;
                const holdAngle = l2n_rotate + (holdDirection < 0 ? 180 : 0);
                const note_body_height = Math.max(
                    holdDirection * hold_full
                    - hold_shrink
                    + (attached ? this_note_head_height / 2 : 0)
                    - note_tail_height / 2
                    , 0
                );

                const note_body_pos = rotate_point(
                    ...(!attached ? note_head_pos : note_atline_pos),
                    (!attached ? this_note_head_height / 2 : 0) + note_body_height / 2,
                    holdAngle);

                sctx.drawCenterRotateImage(
                    sprite_tints.get(note_body_img, note.tint), ...note_body_pos,
                    this_note_width, note_body_height,
                    note_draw_rotate
                );

                // Native Hold adds body renderer first, then head, then tail.
                if (draw_head) sctx.drawCenterRotateImage(sprite_tints.get(note_head_img, note.tint), ...note_head_pos,
                    this_note_width, this_note_head_height, note_draw_rotate);

                const note_tail_pos = rotate_point(
                    ...note_body_pos,
                    note_body_height / 2 + note_tail_height / 2,
                    holdAngle
                );

                sctx.drawCenterRotateImage(
                    sprite_tints.get(note_tail_img, note.tint), ...note_tail_pos,
                    this_note_width, note_tail_height,
                    note_draw_rotate
                );
            }
            sctx.restore();
    }

    const effects = settings.autoplay || C.video_export_active
        ? activeHitEffects(C.chart.data.click_effect_collection, t, settings.speed)
        : judge.hitEffects;
    if (!preview) hit_effects.draw(sctx, effects, t, w, h, settings.noteScale, settings.speed);
    sctx.restore();
};

/* 渲染「某一时刻」的一帧。时间轴 = get_time() 域（秒，即音乐秒），内部再减谱面 offset。
   实时播放（render）与视频导出（export_video）都走这一条路径 —— 导出画面 == 播放画面。 */
const render_frame_at = (t_raw) => {
    if (!cv.width || !cv.height) return;
    const t = t_raw - C.chart.data.offset + (settings.offset / 1000);
    if (settings.autoplay || C.video_export_active) update_game_score(t);
    else {
        C.line_status = { ...judge.stats }; // Native lines update before this frame's judgements.
        if (clock.running) {
            const now = performance.now();
            const deltaSeconds = Math.max(0, (now - judgeFrameTime) / 1000);
            judgementSeconds += deltaSeconds;
            judgeFrameTime = now;
            judge.update(t, cv.width, cv.height, deltaSeconds);
        }
        C.game_hud.score = judge.stats.score;
        C.game_hud.combo = judge.stats.combo;
    }
    update_block_feedback();
    /* 异象分层：黑幕/kaleido/网格在原版挂在 SortingLayer=Background 的
       effect Canvas 上（画在判定线/note 之下），所以场景拆成
       「背景（曲绘）」与「判定线+note」两张画布分别进 GL。 */
    /* F5（audit 2026-10-06 修复）：不只异象 —— 任何带方块的谱也分层，
       否则非 split 路径会把 disabled 方块烘进含 note/判定线的整帧
       （原版 BackCanvas B/2 在判定线/note 之下）。无方块谱仍整帧。 */
    const has_blocks = !!(C.chart.blocks && C.chart.blocks.length);
    const split = !!(((C.postfx_enabled && C.fx_eff) || has_blocks) && C.fx && !C.fx_failed);
    if (split) {
        render_scene(C.bg_cv.getContext("2d"), t, "bg");
        render_scene(C.scene_cv.getContext("2d"), t, "fg");
    } else {
        render_scene(C.scene_cv.getContext("2d"), t);
    }
    // HUD belongs to the foreground scene, so active Block materials sample and cover it too.
    const foreground = C.scene_cv.getContext('2d');
    draw_game_hud(foreground, t_raw);
    render_blocks(foreground, t);
    apply_postfx(C.scene_cv, cv, t, split ? C.bg_cv : null);
};

const render = () => {
    // rAF 必须无条件续上：以前它排在最后，一帧抛异常整条渲染循环就死了，画面永远黑屏
    try {
        // 视频导出期间由 export_video 逐帧驱动，这里让位（否则两边抢同一张画布，
        // 也会把导出帧的时间戳搅乱）
        if (!C.video_export_active) {
            // Monitor moves and browser zoom can change density without a resize event.
            if ((window.devicePixelRatio || 1) !== screen_pixel_density) resize_to_window();
            if (C.entrance?.painted) {
                const now = sceneNow();
                const phase = entrancePhase(C.entrance.start, now, C.entrance.skip, originalUI.duration('StartInfoFadeOut'));
                if (phase === 'enter' && C.scene === 'loading') {
                    transitionScene('loading-exit');
                    C.sceneTransition.start = C.entrance.start + loadingDisplaySeconds;
                } else if (phase === 'opening' && C.scene !== 'game-opening') {
                    transitionScene('game-opening');
                    C.sceneTransition.start = C.entrance.start + (C.entrance.skip ? 0 : loadingDisplaySeconds + originalUI.duration('StartInfoFadeOut'));
                } else if (phase === 'game') {
                    const musicTime = C.entrance.musicTime;
                    C.entrance = null;
                    C.scene = 'game'; cv.dataset.scene = 'game'; C.sceneTransition.duration = 0;
                    clock_seek(musicTime);
                    startMusic();
                }
            }
            if (C.gameOverAt && sceneNow() >= C.gameOverAt) {
                C.gameOverAt = 0;
                transitionScene('result');
            }
            if (C.resumeAt && sceneNow() >= C.resumeAt) { C.resumeAt = 0; startMusic(); }
            const t_raw = get_time();
            if (C.scene === 'ready') {
                // Loading prepares resources only; Start is the first canvas drawing operation.
            } else if (C.scene === 'loading' || C.scene === 'loading-exit') {
                drawSceneOverlay(cv.getContext('2d')!);
            } else if (C.scene === 'game-opening' || C.scene === 'game-over') {
                drawGameplayTransition(cv.getContext('2d')!, sceneNow() - C.sceneTransition.start, C.scene === 'game-over', C.entrance?.musicTime ?? t_raw);
            } else if (C.chart.data) {
                render_frame_at(t_raw);
                update_progress(t_raw);
                drawSceneOverlay(cv.getContext('2d')!);
            } else {
                const out = cv.getContext('2d')!; out.clearRect(0, 0, cv.width, cv.height);
                out.fillStyle = '#111019'; out.fillRect(0, 0, cv.width, cv.height);
                out.fillStyle = '#fff'; out.font = `${Math.max(18, cv.height / 22)}px PhiHUD, sans-serif`; out.textAlign = 'center';
                out.fillText('Loading...', cv.width / 2, cv.height / 2);
                drawSceneOverlay(out);
            }
            if (C.entrance && !C.entrance.painted) {
                C.entrance.painted = true;
                C.entrance.start = sceneNow();
                C.sceneTransition.start = C.entrance.start;
            }
            events.dispatchEvent(new CustomEvent('frame', { detail: simulator.snapshot() }));
            if (clock.running && t_raw >= C.chart.duration + .2 && !finishSent) {
                finishSent = true;
                C.resultStats = simulator.snapshot().stats;
                pause();
                transitionScene('game-over');
                C.gameOverAt = sceneNow() + gameplayEndingSeconds;
                events.dispatchEvent(new CustomEvent('finish', { detail: simulator.snapshot() }));
            }
        }
    } catch (e) {
        console.error("渲染帧出错（已跳过该帧）：", e);
    }
    requestAnimationFrame(render);
};

/* ---------------- 视频导出 ----------------
   Runtime 提供场景绘制及状态恢复；export/ 负责固定帧驱动、离线音频和独立编码器。 */
let exportAbort: AbortController | null = null;

const video_export: { blob: Blob | null; name: string; done: number; total: number; status: string; error: unknown; perf0: number } = {
    blob: null, name: "", done: 0, total: 0, status: "", error: null, perf0: 0
};

/* 导出/跳转预置：t0 是音乐秒，先减谱面 offset，clicked ⇔ sect < 谱面秒。
   预置可避免补播历史打击音，并让跨起点的 Hold 立即按已命中的状态收缩。 */
const preclick_notes = t0 => {
    const t = t0 - C.chart.data.offset;
    for (const line of C.chart.data.judgeLineList) {
        for (const note of line.notes) note.clicked = note.sect < t;
    }
};

const export_filename = (w, h, fps, extension: string) => {
    const info = C.chart.info || {};
    const dir = String(C.chart.dir || "").split("/").filter(Boolean).pop() || "";
    const base = [info.name || "chart", dir, `${w}x${h}`, `${fps}fps`]
        .filter(Boolean).join("_").replace(/[\\/:*?"<>|]/g, "_");
    const d = new Date();
    const p2 = n => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}` +
                  `_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    return `${base}_${stamp}.${extension}`;
};

const render_export_frame = (plan: ExportTimeline, time: number, view: Partial<SceneView>) => {
    const frame = exportFrame(plan, time), ctx = cv.getContext('2d')!;
    if (frame.scene === 'game') render_frame_at(frame.musicTime);
    else if (frame.scene === 'game-opening' || frame.scene === 'game-over') {
        if (frame.scene === 'game-over') update_game_score(frame.musicTime - C.chart.data.offset + settings.offset / 1000);
        else update_game_score(-Infinity);
        drawGameplayTransition(ctx, frame.elapsed, frame.scene === 'game-over', frame.musicTime);
    } else drawSceneOverlay(ctx, frame.scene, frame.elapsed, {
        ...view, collection: frame.scene === 'result' && frame.elapsed >= 2 && Number(view.stats?.score || 0) >= 880000,
    });
};

const export_video = async (opt: ExportScenes & { backend?: ExportBackend; encoding?: Partial<EncodingOptions>; browserCodec?: BrowserCodec; hardwareAcceleration?: HardwareAcceleration; fps?: number; width?: number; height?: number; start?: number; end?: number; bitrate?: number; audio?: boolean } = {}) => {
    if (C.video_export_active) throw new Error("已有导出任务在跑");
    if (!C.chart || !C.chart.data || !C.chart.data.judgeLineList) throw new Error("尚未载入谱面");

    const m = C.chart.music;
    const fps = Math.min(120, Math.max(1, Math.round(opt.fps || 60)));
    const w = Math.max(64, Math.round((opt.width || 1920) / 2) * 2);
    const h = Math.max(64, Math.round((opt.height || 1080) / 2) * 2);
    const dur = C.chart.duration || 0;
    const start = Math.max(0, opt.start != null ? +opt.start : 0);
    let end = opt.end != null ? +opt.end : dur;
    if (!(end > start)) end = Math.max(dur, start + 1);
    end = Math.min(end, Math.max(dur, start) + 10);          // 尾部最多多渲 10s
    const plan = exportTimeline(start, end, opt, originalUI.duration('StartInfoFadeOut'));
    const total = Math.max(1, Math.ceil(plan.duration * fps));
    const mbps = (opt.bitrate || 0) > 0 ? +opt.bitrate!
                                 : Math.max(1, w * h * fps * 0.08 / 1e6);
    const bitrate = Math.round(mbps * 1e6);
    const want_audio = !!opt.audio;

    const was_playing = clock.running || !!(m && !m.paused && !m.ended);
    const prev_pos = clock_t();
    const startedAt = sceneNow(), sceneBefore = { scene: C.scene, entrance: C.entrance ? { ...C.entrance } : null,
        sceneTransition: { ...C.sceneTransition }, resumeAt: C.resumeAt, gameOverAt: C.gameOverAt, resultStarted: C.resultStarted };
    const stageHidden = document.getElementById('stage')!.hidden, resultMusicWasPlaying = !!resultMusicSource;
    const previousCanvas = document.createElement('canvas'); previousCanvas.width = cv.width; previousCanvas.height = cv.height;
    previousCanvas.getContext('2d')!.drawImage(cv, 0, 0);
    const scoringBefore = { ...C.chart.scoring }, hudBefore = { score: C.game_hud.score, combo: C.game_hud.combo };
    const frozenBefore = C.fx_eff?._frozen;
    const clickedBeforeExport = new Map<RuntimeNote, boolean>(C.chart.data.judgeLineList
        .flatMap(line => line.notes).map(note => [note, note.clicked]));

    C.video_export_active = true;
    video_export.blob = null; video_export.error = null;
    video_export.done = 0; video_export.total = total;
    video_export.status = "准备中…";
    video_export.perf0 = 0;

    const controller = new AbortController(); exportAbort = controller;
    try {
        stopResultMusic();
        if (m) pause();
        await originalUI.loadAvatar(settings.playerAvatar);
        update_game_score(end + .2 - C.chart.data.offset + settings.offset / 1000);
        const scoring = C.chart.scoring;
        const view: Partial<SceneView> = {
            // A zero score only reads the previous record; export never writes a new best.
            tip: originalUI.nextTip(), previousBest: recordResult(C.chart.dir || C.chart.info.name, 0),
            stats: { perfect: scoring.perfect, good: 0, bad: 0, miss: 0, score: scoring.score, combo: scoring.combo,
                maxCombo: scoring.max_combo, accuracy: 100, total: scoring.total },
        };
        preclick_notes(start);
        /* 异象冻帧闩锁（glitchDog 的 freezeTime）：从冻结点之后开渲时预置成「已冻结」，
           否则「冻帧当帧」的亮度/对比度 snap 会错跑到片段第一帧。 */
        if (C.fx_eff && C.fx_eff.scalars && C.fx_eff.scalars.freezeTime != null) {
            C.fx_eff._frozen = start >= C.fx_eff.scalars.freezeTime;
        }
        resize_canvases(w, h);
        render_frame_at(start);          // 预热：RT 按新尺寸重建、贴图上传（不计进度）

        const status = (message: string) => { video_export.status = message; export_ui_progress(true); };
        let audio: AudioBuffer | undefined;
        if (want_audio && m) {
            status('渲染音频…');
            audio = await renderAudio(await load_audio(m.currentSrc || m.src), resultMusicBuffers.get(resultMusicFile(C.chart.info.level)), plan, total / fps);
        }
        checkCancelled(controller.signal);
        video_export.perf0 = performance.now();
        const output = await renderVideo(opt.backend || 'ffmpeg', {
            width: w, height: h, fps, frames: total, bitrate, audio, signal: controller.signal, status,
            encoding: opt.encoding, hardwareAcceleration: opt.hardwareAcceleration, browserCodec: opt.browserCodec,
        }, cv, time => render_export_frame(plan, time, view), done => {
            video_export.done = done; export_ui_progress();
            events.dispatchEvent(new CustomEvent('exportframe', { detail: { index: done - 1, time: (done - 1) / fps, backend: opt.backend || 'ffmpeg' } }));
        });
        video_export.blob = output.blob;
        video_export.name = export_filename(w, h, fps, output.extension);
        video_export.status = "完成";
        export_ui_progress(true);
        return video_export.blob;
    } catch (e) {
        const error = controller.signal.aborted ? new Error("已取消") : e;
        video_export.error = error;
        throw error;
    } finally {
        exportAbort = null;
        C.video_export_active = false;
        C.video_export_cancelled = false;
        const exportSeconds = sceneNow() - startedAt;
        Object.assign(C, sceneBefore);
        C.sceneTransition.start += exportSeconds;
        if (C.entrance) C.entrance.start += exportSeconds;
        if (C.resumeAt) C.resumeAt += exportSeconds;
        if (C.gameOverAt) C.gameOverAt += exportSeconds;
        if (C.resultStarted) C.resultStarted += exportSeconds;
        cv.dataset.scene = C.scene;
        document.getElementById('stage')!.hidden = stageHidden;
        resize_to_window();
        clock_seek(prev_pos);
        Object.assign(C.chart.scoring, scoringBefore); Object.assign(C.game_hud, hudBefore);
        if (C.fx_eff) C.fx_eff._frozen = frozenBefore;
        for (const [note, clicked] of clickedBeforeExport) note.clicked = clicked;
        update_progress(prev_pos);
        // 立刻按窗口尺寸重画一帧（后台标签页 rAF 可能被挂起，不能等它）
        cv.getContext('2d')!.drawImage(previousCanvas, 0, 0, cv.width, cv.height);
        if (resultMusicWasPlaying && C.scene === 'result') startResultMusic(startedAt - sceneBefore.sceneTransition.start);
        export_ui_progress(true);
        if (was_playing && C.chart.music) { try { play(); } catch (e) {} }
    }
};

/* ---- 导出面板 ---- */

let export_ui_last = 0;
const fmt_hms = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const export_ui_progress = (force = false) => {
    const now = performance.now();
    if (!force && now - export_ui_last < 120) return;    // 别每帧都摸 DOM
    export_ui_last = now;
    const ve = video_export;
    const pct = ve.total ? ve.done / ve.total : 0;
    ui.export_progress_fill.value = pct * 100;
    let txt = ve.status || "";
    if (ve.done && ve.perf0) {
        const sec = (now - ve.perf0) / 1000;
        const sp = sec > 0.5 ? ve.done / sec : 0;
        if (sp > 0) {
            const eta = Math.max(0, (ve.total - ve.done) / sp);
            txt += ` ${ve.done}/${ve.total} 帧 · ${sp.toFixed(1)} 帧/秒 · 剩余 ${fmt_hms(eta)}`;
        } else {
            txt += ` ${ve.done}/${ve.total} 帧`;
        }
    }
    ui.export_status.textContent = txt;
};

const export_open = () => ui.export_overlay.open;

const auto_bitrate = (w, h, fps) => Math.max(1, Math.round(w * h * fps * 0.08 / 1e6));

const export_collect_opt = () => ({
    backend: ui.export_backend.value as ExportBackend,
    encoding: {
        codec: ui.export_codec.value, container: ui.export_container.value, rateControl: ui.export_rate_control.value,
        crf: Number(ui.export_crf.value), preset: ui.export_preset.value, pixelFormat: ui.export_pixel_format.value,
        proresProfile: Number(ui.export_prores_profile.value), audioCodec: ui.export_audio_codec.value,
        audioBitrate: Number(ui.export_audio_bitrate.value), keyframeSeconds: Number(ui.export_keyframe.value),
        threading: ui.export_threading.value, threads: Number(ui.export_threads.value),
    } as EncodingOptions,
    browserCodec: ui.export_browser_codec.value as BrowserCodec,
    hardwareAcceleration: ui.export_hardware.value as HardwareAcceleration,
    width: parseInt(ui.export_w.value, 10) || 1920,
    height: parseInt(ui.export_h.value, 10) || 1080,
    fps: parseInt(ui.export_fps.value, 10) || 60,
    bitrate: parseFloat(ui.export_bitrate.value) || 0,
    start: Math.max(0, parseFloat(ui.export_start.value) || 0),
    end: (parseFloat(ui.export_end.value) > 0)
        ? parseFloat(ui.export_end.value) : (C.chart.duration || 0),
    audio: ui.export_audio.checked,
    loading: ui.export_loading.checked,
    result: ui.export_result.checked,
    resultSeconds: parseFloat(ui.export_result_seconds.value) || 7,
});

const export_est_update = () => {
    const o = export_collect_opt();
    ui.export_result_seconds.disabled = !o.result;
    const dur = exportTimeline(o.start, o.end, o, originalUI.duration('StartInfoFadeOut')).duration;
    const n = Math.max(1, Math.ceil(dur * o.fps));
    const mbps = o.bitrate > 0 ? o.bitrate : auto_bitrate(o.width, o.height, o.fps);
    const mb = mbps * 1e6 / 8 * dur / 1048576;
    const quality = o.backend === 'ffmpeg' && o.encoding.rateControl === 'crf' && !['prores', 'ffv1'].includes(o.encoding.codec);
    ui.export_est.textContent = quality ? `约 ${n} 帧 · CRF ${o.encoding.crf} · 文件大小随内容变化`
        : o.backend === 'ffmpeg' && ['prores', 'ffv1'].includes(o.encoding.codec) ? `约 ${n} 帧 · 文件大小随内容变化`
        : `约 ${n} 帧 · ${mbps} Mbps${o.bitrate > 0 ? "" : "（自动）"} · 预计 ${mb.toFixed(0)} MB`;
};

const export_encoding_update = () => {
    const ffmpeg = ui.export_backend.value === 'ffmpeg', codec = ui.export_codec.value as FFmpegCodec;
    if (codec === 'hevc' && (!crossOriginIsolated || ui.export_threading.value === 'single')) {
        ui.export_codec.value = 'h264'; export_encoding_update(); return;
    }
    for (const option of ui.export_threading.options) if (option.value === 'multi') option.disabled = !crossOriginIsolated || codec === 'vp9';
    if (ui.export_threading.value === 'multi' && (!crossOriginIsolated || codec === 'vp9')) ui.export_threading.value = 'auto';
    document.getElementById('exp-ffmpeg-options')!.hidden = !ffmpeg;
    document.getElementById('exp-browser-options')!.hidden = ffmpeg;
    const format = videoFormats[codec], fixed = codec === 'ffv1' || codec === 'prores';
    const selectAllowed = (select: HTMLSelectElement, allowed: readonly string[]) => {
        for (const option of select.options) option.disabled = !allowed.includes(option.value);
        if (!allowed.includes(select.value)) select.value = allowed[0];
    };
    selectAllowed(ui.export_container, format.containers);
    selectAllowed(ui.export_pixel_format, format.pixels);
    const container = ui.export_container.value;
    selectAllowed(ui.export_audio_codec, container === 'mp4' ? ['auto','aac'] : container === 'webm' ? ['auto','opus'] : container === 'mov' ? ['auto','aac','pcm'] : ['auto','aac','opus','flac','pcm']);
    ui.export_rate_control.disabled = fixed;
    ui.export_crf.disabled = fixed || ui.export_rate_control.value !== 'crf';
    ui.export_crf.max = codec === 'vp9' ? '63' : '51';
    ui.export_preset.disabled = fixed;
    ui.export_prores_profile.disabled = codec !== 'prores';
    ui.export_bitrate.disabled = ffmpeg && (fixed || ui.export_rate_control.value === 'crf');
    ui.export_threads.disabled = !crossOriginIsolated || ui.export_threading.value === 'single' || codec === 'vp9' || ui.export_threading.value === 'auto' && codec !== 'hevc';
    for (const option of ui.export_codec.options) if (option.value === 'hevc') option.disabled = !crossOriginIsolated || ui.export_threading.value === 'single';
    document.getElementById('exp-thread-status')!.textContent = crossOriginIsolated ? '多线程环境可用（CPU 编码）' : '当前为单线程环境；启用多线程后可使用 HEVC。';
    if (navigator.serviceWorker?.controller?.scriptURL.endsWith('/isolation-service-worker.js')) ui.export_isolation.textContent = '关闭多线程模式并刷新';
    export_est_update();
};

let exportProbeSequence = 0;
const export_probe = async () => {
    const sequence = ++exportProbeSequence;
    const label = document.getElementById('exp-capabilities')!;
    label.textContent = '检测中…';
    const { browserCapabilities } = await import('./export/browser-codec');
    const supported = await browserCapabilities(Number(ui.export_w.value), Number(ui.export_h.value), Number(ui.export_fps.value), ui.export_hardware.value);
    if (sequence !== exportProbeSequence) return;
    label.textContent = supported.length ? `当前分辨率可用：${supported.map(name => name.toUpperCase()).join('、')}（浏览器能力检测）` : '当前分辨率及硬件偏好没有可用编码器。';
    for (const option of ui.export_browser_codec.options) option.disabled = option.value !== 'auto' && !supported.includes(option.value);
};

const open_export_panel = () => {
    if (export_open() || C.video_export_active || lib_loading) return;
    if (!C.chart || !C.chart.data) return;
    pause();
    ui.export_end.value = (C.chart.duration || 0).toFixed(2);
    ui.export_bitrate.value = auto_bitrate(
        parseInt(ui.export_w.value, 10) || 1920,
        parseInt(ui.export_h.value, 10) || 1080,
        parseInt(ui.export_fps.value, 10) || 60);
    ui.export_progress_wrap.hidden = true;
    ui.export_status.textContent = "";
    export_est_update();
    export_encoding_update();
    ui.export_overlay.showModal();
};

const close_export_panel = () => {
    if (!export_open() || C.video_export_active) return;
    ui.export_overlay.close();
};

const export_cancel = () => {
    if (!C.video_export_active) return;
    C.video_export_cancelled = true;
    exportAbort?.abort();
    ui.export_status.textContent = "正在取消…";
};

const export_run_ui = async () => {
    if (C.video_export_active) return;
    ui.export_go.disabled = true;
    ui.export_cancel.disabled = false;
    ui.export_progress_wrap.hidden = false;
    ui.export_status.textContent = "准备中…";
    try {
        const blob = await export_video(export_collect_opt());
        ui.export_status.textContent =
            `完成：${video_export.name}（${(blob.size / 1048576).toFixed(1)} MB），开始下载`;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = video_export.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 120000);
    } catch (e) {
        ui.export_status.textContent = `导出失败：${(e && e.message) || e}`;
        console.error("视频导出失败：", e);
    } finally {
        ui.export_go.disabled = false;
        ui.export_cancel.disabled = true;
    }
};

/* ---------------- 谱面装载 ---------------- */

const rebuild_click_effects = () => {
    const data = C.chart.data;
    data.click_effect_collection = [];
    let effectId = 1;
    for (const line of data.judgeLineList) for (const note of line.notes) {
        if (note.isFake) continue;
        note.effectId = effectId++;
        data.click_effect_collection.push(createHitEffect(note, note.sect, 'perfect'));
        if (note.is_hold) for (const time of autoplayHoldTimes(note, settings.speed)) {
            data.click_effect_collection.push(createHitEffect(note, time, 'perfect'));
        }
    }
    data.click_effect_collection.sort((a, b) => a.time - b.time);
};

const init_chart = () => {
    const data = C.chart.data;
    const note_sect_counter = new Map();
    const lineState = createLineStateResolver(data.judgeLineList, () => game_chart_viewport().aspect);

    for (const line of data.judgeLineList) {
        line.speedEvents.sort((a, b) => a.startTime - b.startTime);
        line.judgeLineRotateEvents.sort((a, b) => a.startTime - b.startTime);
        line.judgeLineMoveEvents.sort((a, b) => a.startTime - b.startTime);
        line.judgeLineDisappearEvents.sort((a, b) => a.startTime - b.startTime);

        line.sec2beat = function (t) { return t / (C.units.pgrbeat / this.bpm); };
        line.beat2sec = function (t) { return t * (C.units.pgrbeat / this.bpm); };
        line.get_state = function (t) {
            const state = lineState(this, t);
            if (!this.animation) return state;
            const viewport = game_chart_viewport();
            return [state[0], (viewport.left + state[1] * viewport.width) / cv.width, state[2], state[3]];
        };
        if (line.animation) line.get_viewport = game_chart_viewport;

        init_speed_events(line.speedEvents);
        line.notes = merge_notes(line.notesAbove, line.notesBelow);
        init_note_fp(line.notes, line.speedEvents);

        for (const note of line.notes) {
            note.sect = line.beat2sec(note.time);
            note.secht = line.beat2sec(note.holdTime);
            note.hold_end_time = note.sect + note.secht;
            note.hold_length = note.secht * note.speed * C.units.pgrh;
            note.is_hold = note.type === C.note.hold;
            note.clicked = false;
            note.master = line;

            if (!note.isFake) {
                if (!note_sect_counter.has(note.sect)) note_sect_counter.set(note.sect, 0);
                note_sect_counter.set(note.sect, note_sect_counter.get(note.sect) + 1);
            }
        }

        delete line.notesAbove;
        delete line.notesBelow;
    }

    for (const line of data.judgeLineList) {
        for (const note of line.notes) {
            note.morebets = +(!note.isFake && note_sect_counter.get(note.sect) > 1);
        }
    }

    init_game_score();
    C.chart.renderLines = orderedLines(data.judgeLineList);
    C.chart.renderNotes = orderedNotes(data.judgeLineList.flatMap(line => line.notes));
    rebuild_click_effects();

    // 方块
    C.chart.blocks = (data.blockAreaList || []).map(b => {
        const bl = b.bottomLeftPercentage, tr = b.topRightPercentage;
        const x0 = Math.min(bl.x, tr.x), x1 = Math.max(bl.x, tr.x);
        const y0 = Math.min(bl.y, tr.y), y1 = Math.max(bl.y, tr.y);
        const sort_ev = k => (b[k] || []).slice().sort((a, c) => a.time - c.time);
        return {
            ...b,
            center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
            size: { x: x1 - x0, y: y1 - y0 },
            moveEvents: sort_ev("moveEvents"),
            scaleEvents: sort_ev("scaleEvents"),
            rotateEvents: sort_ev("rotateEvents")
        };
    }).filter(b => b.size.x > 1e-6 && b.size.y > 1e-6);

    let dur = C.chart.music.duration || 0;
    for (const b of C.chart.blocks) dur = Math.max(dur, b.disappearTime);
    for (const line of data.judgeLineList) {
        for (const note of line.notes) dur = Math.max(dur, note.hold_end_time + data.offset);
    }
    C.chart.duration = dur;

    clock_seek(0);
    draw_progress_marks();
    update_progress(0);
};

// 同一首歌的各难度共用一份曲绘+音乐（assets/library/<song>/ 下共享，
// 见 _migrate_library.py / import_library.py），所以切难度时：
//   - 曲绘 URL 不变 -> <img> 直接命中浏览器缓存；
//   - 音频可以整个复用同一个 <audio> 元素（同一个已解码缓冲），不用重新下载/解码。
// asset_cache 记住最近一次 asset 目录及其已解码资源；assetDir 相同就直接复用。
let asset_cache: { dir: string | null; image_url: string | null; image: HTMLImageElement | null; music: HTMLAudioElement | null } = { dir: null, image_url: null, image: null, music: null };
// 独立于高清曲绘缓存：同歌换难度复用，Happy ending的四个难度则各自取图。
let background_manifest = {};
let background_asset_cache: { url: string | null; image: HTMLImageElement | null } = { url: null, image: null };

const music_ended = () => {
    const m = C.chart.music;
    clock.base = m ? m.duration : 0;
    clock.perf = performance.now();
};

const load_chart = async (dir, assetDir?, anomaly?, imageUrl?) => {
    // dir = 谱面目录（chart.json / info.json）；adir = 共享资源目录（曲绘 / 音乐 / postfx）
    const adir = assetDir || dir;
    const reuse = asset_cache.dir === adir;
    // 曲绘不一致的歌由清单cover指向逐难度图片，音频仍从共享目录读取。
    const image_url = imageUrl || `${adir}/image.png`;

    const progress = { info: 0, chart: 0, image: 0, music: 0 };
    const update = () => {
        const keys = ["info", "chart", "image", "music"];
        const sum = keys.reduce((a, k) => a + progress[k], 0);
        const pct = sum / keys.length;
        ui.loading_fill.value = Math.min(100, pct * 100);
        ui.loading_text.textContent = `${Math.round(pct * 100)}%`;
    };
    ui.loading_overlay.hidden = true;
    ui.loading_label.textContent = "正在加载谱面";
    update();

    const info = await load_json(`${dir}/info.json`);
    C.loadingInfo = info;
    progress.info = 1; update();

    const data = await load_json(`${dir}/chart.json`);
    progress.chart = 1; update();

    // 将预模糊图计入曲绘进度；二者都就绪后image项才完成。
    const background_url = info.background ? R(info.background) : background_manifest[dir];
    const load_background = async () => {
        if (!background_url) return null;
        if (background_asset_cache.url === background_url) return background_asset_cache.image;
        const image = await load_img(background_url);
        background_asset_cache = { url: background_url, image };
        return image;
    };
    let image, music, background;
    if (reuse) {
        // 音频始终复用；曲绘与预模糊图各自按URL判断，不能假设逐难度图片相同。
        [image, background] = await Promise.all([
            asset_cache.image_url === image_url ? asset_cache.image : load_img(image_url),
            load_background()
        ]);
        music = asset_cache.music;
        progress.image = 1; progress.music = 1; update();
    } else {
        [image, background] = await Promise.all([load_img(image_url), load_background()]);
        progress.image = 1; update();

        music = await load_audioele(`${adir}/${info.music || "music.ogg"}`, (got, tot) => {
            progress.music = tot > 0 ? got / tot : 0;
            update();
        });
        asset_cache.music = music;
        asset_cache.dir = adir;
    }
    asset_cache.image = image;
    asset_cache.image_url = image_url;
    C.loadingImage = image;

    // postfx / glitchTex 是**每难度**的（<song>/<DIFF>/postfx.json），不参与共享缓存，
    // 也不跟曲绘音乐一起从 adir 读 —— 读错目录会 404。
    const postfx = await load_json_or_null(`${dir}/postfx.json`);
    const glitch_img = postfx && postfx.glitchTex
        ? await load_img(`${dir}/${postfx.glitchTex}`)
        : null;

    if (C.chart.music && C.chart.music !== music) {
        C.chart.music.pause();
        C.chart.music.remove();
    }
    if (music) {
        // 复用同一个 <audio> 要归零；换歌时是新元素，同样归零
        music.pause();
        try { music.currentTime = 0; } catch (e) { /* 尚未 ready 时忽略 */ }
        music.hidden = true;
        if (!music.isConnected) document.body.appendChild(music);
        // 固定 handler + 先摘后挂，切难度时不会重复注册
        music.removeEventListener("ended", music_ended);
        music.addEventListener("ended", music_ended);
    }

    C.chart.textures?.dispose();
    C.chart.fonts?.dispose(); sprite_tints.clear(); hit_effects.clear();
    C.chart = { info, data, image, background, music, postfx, dir, assetDir: adir, blocks: [] };
    C.resultImage = image;
    C.postfx = postfx;
    C.glitch_img = glitch_img;
    C.chart.music = music;

    /* ★ init_chart 必须在下面的 await 之前：C.chart 已换成新谱面，
       渲染循环（rAF）是并发跑的，若异步窗口里 line 还没挂上 get_state/sec2beat，
       每帧都会抛 "line.get_state is not a function"（切异象谱时实测刷了一串）。
       init_chart 不引用 fx/fx_eff，fx_load_anomaly 不引用 C.chart —— 顺序可安全互换。 */
    init_chart();
    reset_judge();

    /* 首玩异象：清掉上一首的，再按需载入。异象与 s6 那套 postfx 互斥
       （fx_render 里优先走 eff 分支）。anomaly 来自 index.json 的条目，
       可用 URL 参数 ?noanomaly=1 强制关掉。 */
    C.fx_eff = null;
    if (anomaly && !/[?&]noanomaly=1/.test(location.search)) {
        try {
            await fx_load_anomaly(anomaly);
        } catch (e) {
            C.fx_eff = null;
            console.warn("异象载入失败，回退普通画面:", e);
        }
    }

    clock_run(false);
    ui.btn_play.textContent = "开始";
    ui.loading_overlay.hidden = true;
};

/* ---------------- 自动演奏计分 ----------------
   ScoreControl.Update @0x1D87A1C：普通模式
   score = (perfect + 0.65*good)/总note数*900000 + maxcombo/总note数*100000。
   当前播放器所有 note 都自动 Perfect；每个 note 只结算一次，Hold 中途特效不计分。
   HoldControl.Judge @0x1D83B50：已命中的 Hold 在尾端前0.22秒结算，且不能早于头部命中。
   使用排序后的结算时间二分查找，结果仅由当前谱面时间决定：倒退、跳转、重复绘制和
   非零起点的视频导出都不依赖 clicked 或此前渲染过多少帧。 */
const init_game_score = () => {
    const times: number[] = [];
    for (const line of C.chart.data.judgeLineList) {
        for (const note of line.notes) {
            if (note.isFake) continue;
            times.push(note.is_hold ? Math.max(note.sect, note.hold_end_time - 0.22) : note.sect);
        }
    }
    times.sort((a, b) => a - b);
    C.chart.scoring = { times, total: times.length, perfect: 0, combo: 0, max_combo: 0, score: 0 };
    update_game_score(-Infinity);
};

const update_game_score = t => {
    const scoring = C.chart.scoring;
    if (!scoring) return;
    let lo = 0, hi = scoring.total;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        // 与现有自动命中 note.sect < t 一致，边界当帧尚未结算。
        if (scoring.times[mid] < t) lo = mid + 1;
        else hi = mid;
    }
    scoring.perfect = scoring.combo = scoring.max_combo = lo;
    // 原版使用 float32 分步计算并在显示时 +0.5 取整；不要逐 note 累加已取整的单价。
    const f = Math.fround;
    const base = scoring.total ? f(f(lo / scoring.total) * 900000) : 0;
    const bonus = scoring.total ? f(f(lo * 100000) / scoring.total) : 0;
    scoring.score = Math.min(1000000, Math.floor(f(f(base + bonus) + 0.5)));
    C.game_hud.score = scoring.score;
    C.game_hud.combo = scoring.combo;
};

/* ---------------- HUD ---------------- */

const load_game_hud = async () => {
    const font = new FontFace("PhiHUD", `url("${R("/assets/fonts/PhiHUD.ttf")}")`);
    await Promise.all([
        load_img(R("/assets/hud/pause.png")).then(img => C.game_hud.imgs.pause = img),
        load_img(R("/assets/hud/progress.png")).then(img => C.game_hud.imgs.progress = img),
        load_json(R("/assets/hud/glyphs.json"))
            .then(metrics => C.game_hud.font = { metrics })
            .catch(err => console.warn("HUD 字距数据载入失败，使用浏览器字距：", err)),
        font.load().then(face => document.fonts.add(face)).catch(err => {
            console.warn("HUD 字体载入失败，使用备用字体：", err);
        })
    ]);
};

// Level.unity 的 HUD 是 World Space Canvas（局部比例 0.01），相机正交半高 5。
// 因此可见高度是 1000 个 UI 单位，CanvasScaler 的 1920×1080 / match=0.6 不参与屏幕适配。
// LevelUICont.Update @0x1D81B18 会覆盖四角元素的 localPosition，不能使用静态 anchoredPosition。
// UI 开场动画结束后父节点比例为 1；这里先复现正常游玩期间的布局。
// HUD 大小仍按屏高；适配谱面的左右锚点取 cover 内侧，attachUI 再单独施加变换。
const game_hud_layout = (w = cv.width, h = cv.height) =>
    gameHudLayout(w, h, hasChartViewport(C.chart.data) ? chartViewport(w, h, resolveChartAspect(C.chart.data.aspectRatio, settings?.chartAspectRatio)) : undefined);

// UI/TranslucentImage：黑色 Image、spriteBlending=.5、vibrancy=1 时，
// flatten 项为0，最终 RGB = .5 * clamp(blurredBackground + .02, 0, 1)，alpha=1。
// source 相机只拍摄 Layer8 背景，开场拍摄后停用；侧边不能采样含 note/后期的当前帧。
const game_cover_image = () => {
    return game_background(cv.width, cv.height)!.canvas;
};

const draw_game_cover = (ctx: CanvasRenderingContext2D, layout) => {
    const cover = layout.cover;
    if (cover.left <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cover.left - cover.width, 0, cover.width, layout.height);
    ctx.rect(cover.right, 0, cover.width, layout.height);
    ctx.clip();
    ctx.drawImage(game_cover_image(), 0, 0, layout.width, layout.height);
    ctx.restore();
};

// Preserve original advances while avoiding weight inflation from small-size hinting.
const hud_text = new HudTextRenderer();
const draw_game_text = (ctx: CanvasRenderingContext2D, value, size, align: CanvasTextAlign, x, y, max_width, tint?: string) => {
    hud_text.draw(ctx, value, size, align, x, y, max_width, C.game_hud.font?.metrics, tint);
};

const game_hud_attachment = (element: HudElement, t: number, layout = game_hud_layout()) =>
    hudAttachment(C.chart.data.judgeLineList, element, t, (line, time) => (line as any).get_state(time), layout.width, layout.height);

const draw_game_hud = (ctx: CanvasRenderingContext2D, t_raw: number, scaleY = 1, comboAlpha = 1, sideBlend = 1) => {
    if (!chart_started || lib_loading) return;
    if (scaleY !== 1) {
        const buffer = C.hudTransitionCanvas || (C.hudTransitionCanvas = document.createElement('canvas'));
        if (buffer.width !== cv.width || buffer.height !== cv.height) { buffer.width = cv.width; buffer.height = cv.height; }
        const target = buffer.getContext('2d'); target.clearRect(0, 0, buffer.width, buffer.height);
        draw_game_hud(target, t_raw, 1, comboAlpha, sideBlend);
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(buffer, 0, cv.height / 2 * (1 - scaleY), cv.width, cv.height * scaleY); ctx.restore();
        return;
    }
    const hud = C.game_hud;
    const layout = game_hud_layout();
    const chartTime = t_raw - C.chart.data.offset + settings.offset / 1000;
    let hudTint: string | undefined;
    const attached = (element: HudElement, x: number, y: number, draw: () => void) => {
        const attachment = game_hud_attachment(element, chartTime, layout);
        ctx.save(); applyHudAttachment(ctx, attachment, x, y); hudTint = attachment?.color; draw(); hudTint = undefined; ctx.restore();
    };
    ctx.save();
    ctx.setTransform(layout.scale, 0, 0, layout.scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";

    // 原版进度取 nowTime / audioLength，nowTime = audioTime - 谱面 offset。
    const duration = C.chart.music.duration || C.chart.duration || 1;
    const progress = Math.max(0, Math.min(1, (t_raw - C.chart.data.offset) / duration));
    if (hud.imgs.progress && progress > 0) {
        const bar = layout.progress;
        attached('bar', bar.left, bar.height / 2, () => ctx.drawImage(sprite_tints.get(hud.imgs.progress, hudTint), bar.left + bar.span * progress - bar.width,
            0, bar.width, bar.height));
    }
    const button = layout.pause;
    if (hud.imgs.pause) attached('pause', button.x, button.y,
        () => ctx.drawImage(sprite_tints.get(hud.imgs.pause, hudTint), button.x, button.y, button.width, button.height));

    const text = (value, size, align: CanvasTextAlign, x, y, max_width) => draw_game_text(ctx, value, size, align, x, y, max_width, hudTint);
    // Text is drawn about its vertical centre, while RPE attachUI pivots
    // are the top-right score corner and the bottom corners of name/level.
    attached('score', layout.score.x, layout.score.y - 50 / 2,
        () => text(String(Math.round(hud.score)).padStart(7, "0"), 50, "right", layout.score.x, layout.score.y, 400));
    if (hud.combo > 2) {
        attached('combonumber', layout.combo.x, layout.combo.y,
            () => text(hud.combo, 70, "center", layout.combo.x, layout.combo.y, 400));
        ctx.save(); ctx.globalAlpha *= comboAlpha;
        attached('combo', layout.combo_text.x, layout.combo_text.y,
            () => text("COMBO", 24, "center", layout.combo_text.x, layout.combo_text.y, 200)); ctx.restore();
    }
    const name_width = Math.min(650, Math.max(1, (layout.level.x - layout.song.x - 24) / 2));
    attached('name', layout.song.x, layout.song.y + 36 / 2,
        () => text(C.chart.info.name || "", 36, "left", layout.song.x, layout.song.y, name_width));
    // Gameplay 难度只显示整数部分（16.5 → 16），保留谱面库及原始定数。
    const level = (C.chart.info.level || "").replace(/(\d+)\.\d+/g, "$1");
    attached('level', layout.level.x, layout.level.y + 36 / 2,
        () => text(level, 36, "right", layout.level.x, layout.level.y, name_width));
    // Cover overlays the entire HUD, including any attachUI-transformed parts.
    // Keep the animation transform intact; do not clamp or rescale HUD elements.
    ctx.save(); ctx.globalAlpha *= sideBlend; draw_game_cover(ctx, layout); ctx.restore();
    ctx.restore();
};

const drawGameplayTransition = (ctx: CanvasRenderingContext2D, elapsed: number, ending: boolean, musicTime = get_time()) => {
    const width = cv.width, height = cv.height, clip = ending ? 'LevelOver' : 'LevelStart_0';
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.drawImage(game_background(width, height).canvas, 0, 0);
    const backdropAlpha = originalUI.sample(clip, null, 'm_Alpha', elapsed, ending ? 0 : .7);
    ctx.fillStyle = `rgba(0,0,0,${(1 - settings.brightness) * backdropAlpha / .7})`; ctx.fillRect(0, 0, width, height);
    const lineScale = ending ? (elapsed >= 1 && elapsed <= 1.7 ? (1.7 - elapsed) / .7 : 0)
        : originalUI.sample('Began', 'JudgeLine', 'm_ScaleCurves', elapsed, 1, 'x');
    if (ending && lineScale > 0) {
        const time = musicTime - C.chart.data.offset;
        render_scene(C.scene_cv.getContext('2d'), time, 'fg');
        ctx.save(); ctx.translate(width / 2, 0); ctx.scale(lineScale, 1);
        ctx.drawImage(C.scene_cv, -width / 2, 0); ctx.restore();
    }
    if (!ending) {
        // Freeze the full chart at the upcoming playback position. The opening
        // curve expands this entire foreground, including textures and notes;
        // preview drawing never consumes judgements or starts hit feedback.
        const time = musicTime - C.chart.data.offset + settings.offset / 1000;
        const preview = C.openingPreview;
        if (!preview || preview.chart !== C.chart || preview.time !== time || preview.width !== width || preview.height !== height || preview.settings !== settings) {
            render_scene(C.scene_cv.getContext('2d'), time, 'fg', true);
            C.openingPreview = { chart: C.chart, time, width, height, settings };
        }
        ctx.save(); ctx.translate(width / 2, 0); ctx.scale(lineScale, 1);
        ctx.drawImage(C.scene_cv, -width / 2, 0); ctx.restore();
    }
    const scaleY = originalUI.sample(clip, '', 'm_ScaleCurves', elapsed, 1, 'y');
    const comboAlpha = originalUI.sample(clip, 'Canvas (1)/ComboText', 'm_Color.a', elapsed, 1);
    const side = originalUI.sample(clip, null, 'spriteBlending', elapsed, .8);
    draw_game_hud(ctx, musicTime, scaleY, comboAlpha, Math.max(0, Math.min(1, (side - .5) / .3)));
    ctx.restore();
};

// All UI geometry and curves come from the exported Unity scene hierarchy.
const drawSceneOverlay = (ctx: CanvasRenderingContext2D, scene = C.scene, elapsed = sceneNow() - C.sceneTransition.start, overrides: Partial<SceneView> = {}) => {
    const transition = C.sceneTransition;
    const inLoading = scene === 'loading' || scene === 'loading-exit';
    const image = inLoading ? C.loadingImage || C.chart.image : C.chart.image;
    const view = {
        info: inLoading ? C.loadingInfo || C.chart.info || { name: '', level: '' } : C.chart.info,
        image: image?.complete && image.naturalWidth ? image : undefined,
        background: C.chart.image ? game_background(cv.width, cv.height).canvas : undefined,
        frame: undefined,
        settings,
        stats: C.resultStats || simulator.snapshot().stats,
        elapsed,
        collection: C.resultCollection,
        previousBest: C.previousBest || 0,
        showName: settings.playerShowName,
        tip: C.loadingTip,
        ...overrides,
    };
    if (scene === 'loading') originalUI.render(ctx, 'loading', { ...view, elapsed: 3.5, loadingTime: elapsed });
    else if (scene === 'loading-exit') originalUI.render(ctx, 'loading', { ...view, elapsed: 4 + elapsed, loadingTime: loadingDisplaySeconds + elapsed, fadeTime: elapsed });
    else if (scene === 'pause') originalUI.render(ctx, 'pause', { ...view, frame: C.pauseSnapshot || C.scene_cv });
    else if (scene === 'result') originalUI.render(ctx, 'result', view);
    else if (transition.kind === 'pause-out' && elapsed < originalUI.duration('Continue')) {
        originalUI.render(ctx, 'continue', { ...view, frame: C.pauseSnapshot || C.scene_cv });
    } else if (transition.kind === 'loading-out' && elapsed < originalUI.duration('StartInfoFadeOut')) {
        originalUI.render(ctx, 'loading', { ...view, elapsed: 3.5, fadeTime: elapsed });
    }
};

const fmt_time = v => {
    if (!isFinite(v) || v < 0) v = 0;
    return `${v.toFixed(2)}`;
};

const update_progress = t => {
    const dur = C.chart.duration || 1;
    ui.progress_wrap.value = Math.max(0, Math.min(1, t / dur)) * 100;
    ui.time_label.textContent = `${fmt_time(t)} / ${fmt_time(dur)}`;
};

const draw_progress_marks = () => {
    const dur = C.chart.duration || 1;
    const times: number[] = [];
    for (const b of C.chart.blocks) {
        times.push(b.appearTime);
        times.push(b.disappearTime);
    }
    if (C.postfx && C.postfx.curves.glitchRange) {
        times.push(C.postfx.curves.glitchRange[0][0]);
        times.push(C.postfx.curves.brightness[C.postfx.curves.brightness.length - 1][0]);
    }
    const uniq = [...new Set(times)].sort((a, b) => a - b);
    ui.progress_marks.innerHTML = "";
    for (const v of uniq) {
        const i = document.createElement("option");
        i.value = String(Math.max(0, Math.min(1, v / dur)) * 100);
        ui.progress_marks.appendChild(i);
    }
};

const startMusic = () => {
    if (!C.chart.music || lib_loading || C.video_export_active) return;
    if (clock_t() >= C.chart.duration) seek(0);
    if (settings.fullscreen && !document.fullscreenElement) {
        const stage = document.getElementById('stage')!;
        if (stage.requestFullscreen) void stage.requestFullscreen().catch(() => {});
    }
    const m = C.chart.music;
    if (C.scene !== 'game') transitionScene('game');
    const t = clock_t();
    void actx.resume();
    blockAudio.attach(m);
    m.playbackRate = settings.speed;
    m.volume = settings.volume;
    if (t < m.duration) {
        m.currentTime = Math.max(0, t);
        m.play().catch(error => {
            pause();
            events.dispatchEvent(new CustomEvent('error', { detail: `无法播放音乐：${error.message}` }));
        });
    }
    clock_seek(t);
    clock_run(true);
    judgeFrameTime = performance.now();
    ui.btn_play.textContent = "暂停";
};

const beginEntrance = (skipLoading: boolean) => {
    C.chart.music?.pause();
    clock_run(false);
    clear_block_input(true);
    if (settings.autoplay) update_game_score(-Infinity);
    C.game_hud.score = 0; C.game_hud.combo = 0;
    C.openingPreview = null;
    C.entrance = { start: sceneNow(), skip: skipLoading, painted: false, musicTime: clock_t() };
    transitionScene(skipLoading ? 'game-opening' : 'loading');
    ui.btn_play.textContent = skipLoading ? '开始中…' : '加载中…';
};

const play = () => {
    if (!C.chart.music || lib_loading || C.video_export_active || C.entrance || C.resumeAt) return;
    void actx.resume();
    const stage = document.getElementById('stage')!;
    stage.hidden = false;
    resize_to_window();
    if (settings.fullscreen && !document.fullscreenElement) void stage.requestFullscreen().catch(() => {});
    if (C.scene === 'ready') {
        C.loadingTip = originalUI.nextTip();
        beginEntrance(settings.skipLoadingAnimation);
        return;
    }
    if (C.scene === 'pause') {
        transitionScene('game');
        C.resumeAt = sceneNow() + originalUI.duration('Continue');
        return;
    }
    startMusic();
};

const pause = () => {
    C.resumeAt = 0;
    if (C.entrance) preparePlayback();
    if (!C.chart.music) return;
    const t = get_time();
    C.chart.music.pause();
    clock_run(false);
    clock_seek(t);
    clear_block_input();
    ui.btn_play.textContent = "开始";
};

const toggle_play = () => {
    if (!C.chart.music || lib_loading || C.video_export_active) return;
    if (C.scene === 'pause') { play(); return; }
    if (clock.running || !C.chart.music.paused) { pause(); transitionScene('pause'); }
    else play();
};

const seek = v => {
    const m = C.chart.music;
    v = Math.max(0, Math.min(C.chart.duration, v));
    if (!m.paused && !m.ended) m.currentTime = Math.min(v, m.duration);
    clock_seek(v);
    // 跳过的 note 视为已自动命中，避免跳转后补播全部历史打击音。
    reset_judge(v - C.chart.data.offset + settings.offset / 1000);
    if (settings.autoplay) preclick_notes(v);
    finishSent = false;
    update_game_score(v - C.chart.data.offset);
    update_progress(v);
};

/* ---------------- 底栏显隐 ---------------- */
// Native playback controls below the canvas can be toggled with B.
const toggle_bottom_bar = () => { ui.bottom_bar.hidden = !ui.bottom_bar.hidden; };

/* ---------------- 谱面库 ---------------- */
let chart_started = false;
let render_started = false;
let lib_loading = false;

const open_library = () => {
    if (lib_loading) return;
    stopResultMusic();
    pause();
    events.dispatchEvent(new Event('library'));
};

const init_player = async () => {
    C.scene_cv = document.createElement("canvas");
    C.bg_cv = document.createElement("canvas");   // 异象分层：曲绘专用背景画布
    C.block_cv = document.createElement("canvas");
    C.block_sub_cv = document.createElement("canvas");
    C.block_sub_count_cv = document.createElement('canvas');

    resize_to_window();
    if (!render_started) { render_started = true; render(); }
    window.addEventListener('resize', resize_to_window);
    document.addEventListener("fullscreenchange", resize_to_window);
    document.addEventListener("webkitfullscreenchange", resize_to_window);

    // 首次访问外网时资源可能很慢：立即显示启动进度，独立资源并行下载。
    // 每项最多等待60秒，失败时保留具体错误，避免所有浮层隐藏后的无提示黑屏。
    let boot_done = 0, boot_failed = false;
    const tasks: [string, () => Promise<unknown>][] = [
        ["assets/audio/click.ogg", async () => C.click_sounds[C.note.tap] = await load_audio(R("/assets/audio/click.ogg"))],
        ["assets/audio/drag.ogg", async () => C.click_sounds[C.note.drag] = await load_audio(R("/assets/audio/drag.ogg"))],
        ["assets/audio/flick.ogg", async () => C.click_sounds[C.note.flick] = await load_audio(R("/assets/audio/flick.ogg"))],
        ...resultMusicFiles.map(file => [file, async () => { resultMusicBuffers.set(file, await load_audio(R(file))); }] as [string, () => Promise<unknown>]),
        ...["click", "drag", "hold", "flick", "click_mh", "drag_mh", "hold_mh", "flick_mh"].map(key =>
            [`assets/gameplay/notes/${key}.png`, async () => C.note_imgs[key] = await load_img(R(`/assets/gameplay/notes/${key}.png`))] as [string, () => Promise<unknown>]),
        ["assets/gameplay/notes/bad_tap.png", async () => {
            const image = await load_img(R('/assets/gameplay/notes/bad_tap.png'));
            const canvas = document.createElement('canvas');
            canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(image, 0, 0);
            ctx.globalCompositeOperation = 'multiply';
            ctx.fillStyle = 'rgb(108,67,67)'; ctx.fillRect(0, 0, image.width, image.height);
            ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(image, 0, 0);
            C.note_imgs.badTap = canvas;
        }],
        ["assets/gameplay/hit-effects/respack.json", async () => C.respack_info = await load_json(R("/assets/gameplay/hit-effects/respack.json"))],
        ["assets/gameplay/hit-effects/hit_fx.png", async () => C.hit_fx = await load_img(R("/assets/gameplay/hit-effects/hit_fx.png"))],
        ["assets/gameplay/blocks/BlockNoise1.png", async () => C.block.imgs.displace = await load_img(R("/assets/gameplay/blocks/BlockNoise1.png"))],
        ["assets/gameplay/blocks/PointNoise.png", async () => C.block.imgs.spark = await load_img(R("/assets/gameplay/blocks/PointNoise.png"))],
        ["assets/gameplay/blocks/TouchNoise.png", async () => C.block.imgs.touchNoise = await load_img(R("/assets/gameplay/blocks/TouchNoise.png"))],
        ["assets/gameplay/blocks/TouchHover.png", async () => {
            const image = await load_img(R('/assets/gameplay/blocks/TouchHover.png'));
            C.block.imgs.touchHover = image;
            const canvas = document.createElement('canvas');
            canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, image.width, image.height);
            ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(image, 0, 0);
            C.block.imgs.touchHoverFlat = canvas;
        }],
        ["HUD 字体和图标", load_game_hud],
        ["Unity original scenes", async () => { await originalUI.load(R); await originalUI.loadProfiles(R); await originalUI.loadAvatar(settings.playerAvatar); }],
        ["assets/shaders/ 着色器", load_shaders]
    ];
    const pending = new Set(tasks.map(([name]) => name));
    const boot_progress = () => {
        if (boot_failed) return;
        ui.loading_fill.value = boot_done / tasks.length * 100;
        ui.loading_text.textContent = `${boot_done}/${tasks.length} · 等待 ${[...pending].join("、")}`;
    };
    boot_progress();
    await Promise.all(tasks.map(async ([name, load]) => {
        let timer;
        try {
            await Promise.race([
                load(),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`加载超时：${name}`)), 60000);
                })
            ]);
            pending.delete(name);
            boot_done++;
            boot_progress();
        } catch (err) {
            boot_failed = true;
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }));
    C.click_sounds[C.note.hold] = C.click_sounds[C.note.tap];

    [C.note_imgs.hold_head, C.note_imgs.hold_body, C.note_imgs.hold_tail] =
        clip_hold(C.note_imgs.hold, C.respack_info.holdAtlas);
    [C.note_imgs.hold_mh_head, C.note_imgs.hold_mh_body, C.note_imgs.hold_mh_tail] =
        clip_hold(C.note_imgs.hold_mh, C.respack_info.holdAtlasMH);

    C.note_head_imgs = {
        [C.note.tap]: [C.note_imgs.click, C.note_imgs.click_mh],
        [C.note.drag]: [C.note_imgs.drag, C.note_imgs.drag_mh],
        [C.note.flick]: [C.note_imgs.flick, C.note_imgs.flick_mh],
        [C.note.hold]: [C.note_imgs.hold_head, C.note_imgs.hold_mh_head]
    };

    C.hold_body_imgs = [C.note_imgs.hold_body, C.note_imgs.hold_mh_body];
    C.hold_tail_imgs = [C.note_imgs.hold_tail, C.note_imgs.hold_mh_tail];

    const originalHitFrames: CanvasImageSource[] = [];
    for (let j = 0; j < C.respack_info.hitFx[1]; j++) {
        for (let i = 0; i < C.respack_info.hitFx[0]; i++) {
            const frame = clip_block_img(C.hit_fx,
                (i / C.respack_info.hitFx[0]) * C.hit_fx.width,
                (j / C.respack_info.hitFx[1]) * C.hit_fx.height,
                ((i + 1) / C.respack_info.hitFx[0]) * C.hit_fx.width,
                ((j + 1) / C.respack_info.hitFx[1]) * C.hit_fx.height);
            const goodFrame = clip_block_img(frame, 0, 0, frame.width, frame.height);
            originalHitFrames.push(clip_block_img(frame, 0, 0, frame.width, frame.height));
            C.hit_fx_imgs.perfect.push(cv_put_color(frame, [255, 236, 160]));
            C.hit_fx_imgs.good.push(cv_put_color(goodFrame, [180, 225, 255]));
        }
    }

    hit_effects.setFrames(C.hit_fx_imgs);
    hit_effects.setOriginalFrames(originalHitFrames);

    ui.loading_text.textContent = "正在加载谱面库…";
    const backgrounds = await load_json_or_null(R("/assets/backgrounds/index.json"));
    background_manifest = Object.fromEntries(Object.entries(backgrounds && backgrounds.charts || {})
        .filter(([, image]) => typeof image === 'string')
        .map(([path, image]) => [R(path), R(String(image))]));
    ui.loading_overlay.hidden = true;

    ui.btn_play.onclick = toggle_play;

    // Canvas 菜单使用原始场景几何进行按钮命中测试。
    cv.addEventListener("click", e => {
        if ((!chart_started && C.scene !== 'result') || lib_loading || export_open() || C.video_export_active) return;
        const rect = cv.getBoundingClientRect();
        const layout = game_hud_layout();
        const x = (e.clientX - rect.left) * cv.width / rect.width / layout.scale;
        const y = (e.clientY - rect.top) * cv.height / rect.height / layout.scale;
        const action = originalUI.hit((e.clientX - rect.left) * cv.width / rect.width, (e.clientY - rect.top) * cv.height / rect.height);
        if (C.scene === 'result') {
            if (action === 'Retry') simulator.restart();
            else if (action === 'Back') { transitionScene('game'); open_library(); }
            return;
        }
        if (C.scene === 'pause') {
            if (action === 'Back') { transitionScene('game'); open_library(); }
            else if (action === 'Retry') simulator.restart();
            else if (action === 'Resume') play();
            return;
        }
        if (C.scene !== 'game') return;
        if (hudPointCovered(x, y, layout)) return;
        const button = layout.pause;
        const attachment = game_hud_attachment('pause', get_time() - C.chart.data.offset + settings.offset / 1000, layout);
        const point = inverseHudPoint(x, y, attachment, button.x, button.y);
        if (point && point[0] >= button.x - 12 && point[0] <= button.x + button.width + 12 &&
            point[1] >= button.y - 12 && point[1] <= button.y + button.height + 12) { pause(); transitionScene('pause'); }
    });

    /* 导出视频面板 */
    ui.btn_export.onclick = open_export_panel;
    ui.export_close.onclick = close_export_panel;
    ui.export_overlay.addEventListener('cancel', e => {
        e.preventDefault();
        if (C.video_export_active) export_cancel();
        else close_export_panel();
    });
    ui.export_overlay.onclick = e => {
        if (e.target === ui.export_overlay) close_export_panel();
    };
    for (const key of ["export_w", "export_h", "export_fps", "export_bitrate", "export_start", "export_end", "export_result_seconds"]) {
        ui[key].addEventListener("input", export_est_update);
    }
    for (const key of ['export_w','export_h','export_fps']) ui[key].addEventListener('input', () => {
        exportProbeSequence++;
        document.getElementById('exp-capabilities')!.textContent = '参数已更改，可重新检测编码支持。';
        for (const option of ui.export_browser_codec.options) option.disabled = false;
    });
    ui.export_audio.addEventListener("change", export_est_update);
    for (const key of ['export_backend','export_codec','export_container','export_rate_control','export_preset','export_pixel_format','export_prores_profile','export_audio_codec']) ui[key].addEventListener('change', export_encoding_update);
    for (const key of ['export_crf','export_audio_bitrate','export_keyframe']) ui[key].addEventListener('input', export_est_update);
    ui.export_probe.onclick = () => { void export_probe(); };
    ui.export_hardware.onchange = () => { void export_probe(); };
    ui.export_threading.onchange = export_encoding_update;
    ui.export_isolation.onclick = () => { void import('./export/isolation').then(module => module.toggleIsolation()).catch(error => { ui.export_status.textContent = String(error); }); };
    ui.export_loading.addEventListener("change", export_est_update);
    ui.export_result.addEventListener("change", export_est_update);
    ui.export_p720.onclick = () => { ui.export_w.value = "1280"; ui.export_h.value = "720"; export_est_update(); };
    ui.export_p1080.onclick = () => { ui.export_w.value = "1920"; ui.export_h.value = "1080"; export_est_update(); };
    ui.export_pwin.onclick = () => {
        ui.export_w.value = String(window.innerWidth);
        ui.export_h.value = String(window.innerHeight);
        export_est_update();
    };
    ui.export_whole.onclick = () => {
        ui.export_start.value = "0";
        ui.export_end.value = (C.chart.duration || 0).toFixed(2);
        export_est_update();
    };
    ui.export_here.onclick = () => {
        ui.export_start.value = clock_t().toFixed(2);
        ui.export_end.value = (C.chart.duration || 0).toFixed(2);
        export_est_update();
    };
    ui.export_go.onclick = export_run_ui;
    ui.export_cancel.onclick = export_cancel;

    ui.progress_wrap.oninput = () => {
        if (C.chart.data && !C.video_export_active) seek(Number(ui.progress_wrap.value) / 100 * C.chart.duration);
    };

    window.addEventListener('keydown', e => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
        if (!C.chart.data) return;
        if (C.video_export_active) {
            if (e.code === "Escape") { e.preventDefault(); export_cancel(); }
            return;                      // 导出期间锁输入：空格/方向键别去碰播放时钟
        }
        if (export_open()) {
            if (e.code === "Escape" || e.code === "Space") {
                e.preventDefault();
                close_export_panel();
            }
            return;
        }
        if (lib_loading) return;
        if (e.code === "Space") {
            e.preventDefault();
            toggle_play();
        } else if (e.code === "ArrowLeft") {
            seek(get_time() - 2);
        } else if (e.code === "ArrowRight") {
            seek(get_time() + 2);
        } else if (e.code === "KeyL") {
            open_library();
        } else if (e.code === "KeyV") {
            open_export_panel();
        } else if (e.code === "KeyB") {
            toggle_bottom_bar();
        }
    });
};

function reset_judge(time = -Infinity) {
    const notes: RuntimeNote[] = C.chart.data.judgeLineList.flatMap(line => line.notes);
    judge.reset(notes, time);
    judgementSeconds = 0;
    C.line_status = { ...judge.stats };
    judgeFrameTime = performance.now();
    clear_block_input(true);
    finishSent = false;
}

export const simulator = {
    events,
    canvas: cv,
    async init(initialSettings: Settings) {
        settings = initialSettings;
        judge.onHit = note => play_sound(note_sound(note));
        await init_player();
    },
    async load(entry: { path: string; asset?: string; cover?: string; anomaly?: string; name?: string; level?: string; composer?: string; charter?: string; illustrator?: string }) {
        pause();
        preparePlayback();
        C.loadingInfo = { name: entry.name, level: entry.level, composer: entry.composer, charter: entry.charter, illustrator: entry.illustrator };
        if (entry.cover) { const cover = new Image(); cover.src = R(entry.cover); C.loadingImage = cover; }
        else C.loadingImage = C.chart.image || null;
        if (!render_started) { render_started = true; render(); }
        lib_loading = true;
        try {
            await load_chart(R(entry.path), R(entry.asset || entry.path), entry.anomaly, entry.cover ? R(entry.cover) : undefined);
            this.ready();
        } finally { lib_loading = false; ui.loading_overlay.hidden = true; }
    },
    async loadLocal(chart: LocalChart) {
        pause();
        preparePlayback();
        C.loadingInfo = chart.info; C.loadingImage = chart.image || null;
        if (!render_started) { render_started = true; render(); }
        lib_loading = true;
        const urls: string[] = [];
        let textures: ChartTextures | undefined;
        let fonts: ChartFonts | undefined;
        const url = (blob: Blob) => { const value = URL.createObjectURL(blob); urls.push(value); return value; };
        try {
            const music = await load_audioele(url(chart.music));
            const image = await load_img(chart.image ? url(chart.image) : R('/assets/builtin/s6/image.png'));
            textures = await ChartTextures.load(chart.textures);
            fonts = await ChartFonts.load(chart.fonts);
            const hitsounds = Object.fromEntries(await Promise.all(Object.entries(chart.hitsounds ?? {}).map(async ([name, blob]) =>
                [name, await actx.decodeAudioData(await blob.arrayBuffer())])));
            C.chart.music?.pause();
            C.chart.music?.remove();
            localUrls.forEach(value => URL.revokeObjectURL(value));
            localUrls = urls;
            C.chart.textures?.dispose();
            C.chart.fonts?.dispose(); sprite_tints.clear(); hit_effects.clear();
            C.chart = { info: chart.info, data: structuredClone(chart.data), music, image, background: null,
                postfx: chart.postfx || null, blocks: [], dir: chart.id, assetDir: chart.id, textures, fonts, hitsounds };
            C.loadingImage = image; C.resultImage = image;
            C.postfx = chart.postfx || null;
            C.glitch_img = null;
            C.fx_eff = null;
            game_background_cache = null;
            init_chart();
            reset_judge();
            this.ready();
        } catch (error) { textures?.dispose(); fonts?.dispose(); urls.forEach(value => URL.revokeObjectURL(value)); throw error; }
        finally { lib_loading = false; }
    },
    ready() {
        chart_started = true;
        preparePlayback();
        C.resultStats = null; C.resultImage = C.chart.image;
        finishSent = false;
        ui.btn_play.textContent = "开始";
        resize_to_window();
        if (!render_started) { render_started = true; render(); }
        events.dispatchEvent(new CustomEvent('loaded', { detail: this.snapshot() }));
    },
    configure(value: Settings) {
        if (C.video_export_active) return;
        const t = get_time();
        const modeChanged = settings.autoplay !== value.autoplay;
        const speedChanged = settings.speed !== value.speed;
        settings = { ...value };
        resultMusicGain.gain.value = settings.volume;
        const profileReady = originalUI.loadAvatar(settings.playerAvatar).catch(error => {
            events.dispatchEvent(new CustomEvent('error', { detail: `无法载入头像：${error.message}` }));
        });
        if (speedChanged && C.chart.data) rebuild_click_effects();
        clock_seek(t);
        if (C.chart.music) { C.chart.music.playbackRate = settings.speed; C.chart.music.volume = settings.volume; }
        C.postfx_enabled = settings.effects;
        if (modeChanged && C.chart.data) seek(0);
        return profileReady;
    },
    updateInfo(patch: Partial<ChartInfo>): boolean {
        if (!C.chart.data || lib_loading || C.video_export_active) return false;
        C.chart.info = { ...C.chart.info, ...patch };
        return true;
    },
    snapshot() {
        return {
            scene: C.scene,
            loaded: !!C.chart.data, playing: clock.running, time: get_time(), duration: C.chart.duration || 0,
            info: C.chart.info, exporting: !!C.video_export_active,
            blockedTouches: judge.blockedTouches.length,
            stats: settings.autoplay ? {
                ...judge.stats, perfect: C.chart.scoring?.perfect || 0, good: 0, bad: 0, miss: 0,
                score: C.game_hud.score, combo: C.game_hud.combo, maxCombo: C.game_hud.combo,
                accuracy: 100, total: C.chart.scoring?.total || 0,
            } : { ...judge.stats },
        };
    },
    avatars() { return originalUI.avatars(); },
    play() { play(); },
    pause,
    seek(value: number) { if (C.chart.data && !C.video_export_active) seek(value); },
    restart() {
        if (!C.chart.data || C.video_export_active || lib_loading) return;
        pause(); C.entrance = null; C.resumeAt = 0; C.gameOverAt = 0; C.resultStats = null;
        seek(0); document.getElementById('stage')!.hidden = false;
        beginEntrance(true);
    },
    hit(id: string, x: number, y: number, kind: 'tap' | 'move' | 'release', keyboard = false) {
        if (!clock.running || settings.autoplay || C.video_export_active || lib_loading || export_open()) return;
        judge.input(id, x, y, kind, get_time() - C.chart.data.offset + settings.offset / 1000, cv.width, cv.height, keyboard);
        update_block_feedback();
    },
    clearInput() { clear_block_input(); },
    exportVideo() { if (C.chart.data) open_export_panel(); },
};
