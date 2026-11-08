import type { ChartInfo, Settings, Statistics } from '../types';
import { resultGrade } from './result-records';
import { efficientBlur, shadowBlurConfig, translucentTint } from './unity-blur';
import { avatarId, parseTips, type AvatarEntry } from './profile-assets';
import { fakeSyncFrame, type SyncFrame } from './result-sync';

type Vector = { x: number; y: number; z?: number; w?: number };
type Data = Record<string, any>;
interface Component { id: number; classId: number; data: Data; script: string | Data; font?: Data; sprite?: { image: string; rect: Data; offset?: Vector }; points?: Vector[]; clips?: string[]; targets?: Record<string, string> }
interface Node { id: string; transformId: number; name: string; path: string; parent: string | null; children: string[]; active: boolean; scale: Vector; position: Vector; rotation: Vector; anchorMin?: Vector; anchorMax?: Vector; anchoredPosition?: Vector; sizeDelta?: Vector; pivot?: Vector; components: Component[] }
interface Scene { nodes: Record<string, Node>; bindings: Record<string, Data> }
export interface UnityKey { time: number; value: number | Vector; inSlope: number | Vector | string; outSlope: number | Vector | string; weightedMode?: number; inWeight?: number; outWeight?: number }
interface Track { path: string; attribute: string; classId: number; keys: UnityKey[] }
interface Clip { duration: number; loop: number; tracks: Track[] }
interface Export { scenes: Record<string, Scene>; clips: Record<string, Clip>; textures: Record<string, string> }
export interface SceneView {
  info: ChartInfo; image?: CanvasImageSource; background?: CanvasImageSource; frame?: CanvasImageSource;
  settings: Settings; stats: Statistics & { early?: number; late?: number }; elapsed: number;
  collection?: boolean; previousBest?: number; resume?: boolean; showName?: boolean;
  fadeTime?: number;
  loadingTime?: number;
  tip?: string;
}

// Unity's unweighted AnimationCurve segments are cubic Hermite, including step tangents.
export function unityKeyValue(keys: UnityKey[], time: number, axis?: keyof Vector): number {
  const read = (value: any): number => axis ? Number(value?.[axis] ?? 0) : Number(value);
  if (time <= keys[0].time) return read(keys[0].value);
  const last = keys[keys.length - 1];
  if (time >= last.time) return read(last.value);
  let lo = 0, hi = keys.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (keys[mid].time <= time) lo = mid; else hi = mid; }
  const a = keys[lo], b = keys[hi], span = b.time - a.time, p = (time - a.time) / span;
  const va = read(a.value), vb = read(b.value), ma = read(a.outSlope), mb = read(b.inSlope);
  if (!Number.isFinite(ma) || !Number.isFinite(mb)) return va;
  return (2 * p ** 3 - 3 * p ** 2 + 1) * va + (p ** 3 - 2 * p ** 2 + p) * span * ma
    + (-2 * p ** 3 + 3 * p ** 2) * vb + (p ** 3 - p ** 2) * span * mb;
}

const color = (v: Data) => `rgb(${Math.round(v.r * 255)},${Math.round(v.g * 255)},${Math.round(v.b * 255)})`;
const white: Data = { r: 1, g: 1, b: 1, a: 1 };
const half = { x: .5, y: .5 };

export class UnityUI {
  private data!: Export;
  private images = new Map<string, HTMLImageElement>();
  private sprites = new Map<string, HTMLCanvasElement>();
  private shadows = new Map<string, { image: HTMLCanvasElement; x: number; y: number }>();
  private textRasters = new Map<string, { image: HTMLCanvasElement; left: number; top: number }>();
  private avatarEntries: AvatarEntry[] = [];
  private avatarRequests = new Map<string, Promise<void>>();
  private assetPath!: (path: string) => string;
  private tips: string[] = [];
  private activeTip = '';
  private hitRegions: { name: string; path: Path2D }[] = [];
  private hitContext = document.createElement('canvas').getContext('2d')!;
  private drawBackground!: CanvasImageSource;
  private blurredFrame?: { source: CanvasImageSource; image: HTMLCanvasElement; pixels: Uint8ClampedArray };
  private filteredFrame?: { source: CanvasImageSource; vibrancy: number; brightness: number; image: HTMLCanvasElement };

  private translucentFrame(source: CanvasImageSource, vibrancy: number, brightness: number): HTMLCanvasElement {
    if (this.filteredFrame?.source === source && this.filteredFrame.vibrancy === vibrancy && this.filteredFrame.brightness === brightness) return this.filteredFrame.image;
    if (this.blurredFrame?.source !== source) {
      const width = (source as HTMLCanvasElement).width, height = (source as HTMLCanvasElement).height;
      const original = document.createElement('canvas'); original.width = width; original.height = height;
      original.getContext('2d')!.drawImage(source, 0, 0);
      const radius = 2 * Math.max(.5, Math.min(2, Math.min(width, height) / 1080));
      const image = efficientBlur(original, radius, 4);
      const ctx = image.getContext('2d')!;
      this.blurredFrame = { source, image, pixels: ctx.getImageData(0, 0, image.width, image.height).data };
    }
    const filtered = translucentTint(this.blurredFrame!.image, vibrancy, brightness);
    if (filtered) {
      this.filteredFrame = { source, vibrancy, brightness, image: filtered }; return filtered;
    }
    const base = this.blurredFrame!, image = document.createElement('canvas'); image.width = base.image.width; image.height = base.image.height;
    const ctx = image.getContext('2d')!, pixels = ctx.createImageData(image.width, image.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const r = base.pixels[i] / 255, g = base.pixels[i + 1] / 255, b = base.pixels[i + 2] / 255;
      const gray = .22 * r + .707 * g + .071 * b;
      for (const [j, v] of [r, g, b].entries()) pixels.data[i + j] = Math.max(0, Math.min(1, Math.max(0, Math.min(1, gray + vibrancy * (v - gray))) + brightness)) * 255;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0); this.filteredFrame = { source, vibrancy, brightness, image };
    return image;
  }

  async load(asset: (path: string) => string): Promise<void> {
    this.assetPath = asset;
    const response = await fetch(asset('/assets/ui/scenes.json'));
    if (!response.ok) throw new Error(`Original UI scene data: ${response.status}`);
    this.data = await response.json();
    await Promise.all(Object.keys(this.data.textures).map(async name => {
      const image = new Image(); image.src = asset('/assets/ui/' + name); await image.decode(); this.images.set(name, image);
    }));
    const font = new FontFace('SceneHot', `url("${asset('/assets/fonts/SceneHot.ttf')}")`);
    document.fonts.add(await font.load());
    const tips = await fetch(asset('/assets/tips.txt'));
    if (!tips.ok) throw new Error(`Loading tips: ${tips.status}`);
    this.tips = parseTips(await tips.text());
    this.nextTip();
  }

  nextTip(): string { return this.activeTip = this.tips[Math.floor(Math.random() * this.tips.length)] || ''; }
  avatars(): readonly AvatarEntry[] { return this.avatarEntries; }

  async loadAvatar(value: string): Promise<void> {
    const id = avatarId(value);
    if (this.images.has('profile-' + id)) return;
    let pending = this.avatarRequests.get(id);
    if (!pending) {
      const entry = this.avatarEntries.find(entry => entry.id === id);
      if (!entry) return;
      pending = (async () => {
        const image = new Image(); image.src = this.assetPath('/assets/avatars/' + encodeURIComponent(entry.file));
        await image.decode(); this.images.set('profile-' + id, image);
      })();
      this.avatarRequests.set(id, pending);
    }
    await pending;
  }

  duration(name: string): number { return this.data?.clips[name]?.duration || 0; }

  syncFrame(elapsed: number): SyncFrame {
    return fakeSyncFrame(elapsed, {
      delay: this.data.scenes.result.bindings.AutoSyncControl.animOffset,
      show: this.duration('SyncShow'), loop: this.duration('Sync'), success: this.duration('SyncSuccess'),
    });
  }

  sample(name: string, path: string | null, attribute: string, time: number, fallback: number, axis?: keyof Vector): number {
    const track = this.data?.clips[name]?.tracks.find(t => (path === null || t.path === path) && t.attribute === attribute);
    return track ? unityKeyValue(track.keys, time, axis) : fallback;
  }

  private animate(scene: Scene, clipName: string, rootPath: string, time: number): Map<string, Data> {
    const result = new Map<string, Data>(), clip = this.data.clips[clipName];
    if (!clip) return result;
    const animator = Object.values(scene.nodes).find(n => n.path === rootPath)?.components.find(c => c.clips?.includes(clipName));
    for (const track of clip.tracks) {
      const target = animator?.targets?.[track.path] || Object.values(scene.nodes).find(n => n.path === rootPath + (track.path ? '/' + track.path : ''))?.id;
      if (!target) continue;
      const patch = result.get(target) || {};
      if (typeof track.keys[0].value === 'object') {
        for (const axis of ['x', 'y', 'z'] as const) patch[track.attribute + '.' + axis] = unityKeyValue(track.keys, time, axis);
      } else patch[track.attribute] = unityKeyValue(track.keys, time);
      result.set(target, patch);
    }
    return result;
  }

  private sprite(component: Component, tint: Data): CanvasImageSource | undefined {
    const sprite = component.sprite;
    if (!sprite) return;
    const key = JSON.stringify([sprite, tint.r, tint.g, tint.b]);
    let canvas = this.sprites.get(key);
    if (!canvas) {
      const image = this.images.get(sprite.image); if (!image) return;
      const r = sprite.rect; canvas = document.createElement('canvas');
      const atlas = image.width > 1024 && r.width < 100 && r.height < 100;
      const padding = atlas ? Math.max(r.width, r.height) : 0;
      canvas.width = atlas ? Math.ceil(padding) : image.width < 256 ? image.width : Math.ceil(r.width);
      canvas.height = atlas ? Math.ceil(padding) : image.height < 256 ? image.height : Math.ceil(r.height);
      const ctx = canvas.getContext('2d')!;
      if (image.width < 256 && image.height < 256) ctx.drawImage(image, 0, 0);
      else ctx.drawImage(image, r.x, image.height - r.y - r.height, r.width, r.height,
        atlas ? (canvas.width - r.width) / 2 - (sprite.offset?.x || 0) : 0,
        atlas ? (canvas.height - r.height) / 2 + (sprite.offset?.y || 0) : 0, r.width, r.height);
      if (tint.r !== 1 || tint.g !== 1 || tint.b !== 1) {
        ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = color(tint); ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      this.sprites.set(key, canvas);
    }
    return canvas;
  }

  hit(x: number, y: number): string | undefined {
    return [...this.hitRegions].reverse().find(region => this.hitContext.isPointInPath(region.path, x, y))?.name;
  }

  render(ctx: CanvasRenderingContext2D, name: 'loading' | 'pause' | 'continue' | 'result', view: SceneView): void {
    if (!this.data) return;
    this.hitRegions = [];
    const source = name === 'loading' ? 'intro' : name === 'result' ? 'result' : 'level';
    const scene = this.data.scenes[source];
    const clip = name === 'result' ? 'LevelOvarAnimation' : name === 'loading' ? 'LevelStart' : name === 'continue' ? 'Continue' : 'Pause';
    const rootPath = name === 'result' ? 'Canvas' : name === 'loading' ? 'Canvas (1)/StartInfos/StartAnimation' : name === 'continue' ? 'ContinuePrefab' : 'PauseCanvas/Pause Bar';
    const time = view.elapsed;
    const patches = this.animate(scene, clip, rootPath, time);
    const patch = (id: string, values: Data) => patches.set(id, { ...patches.get(id), ...values });
    const texts = new Map<number, string>();
    const dynamicImages = new Map<string, CanvasImageSource>();
    const hidden = new Set<string>(), enabled = new Set<string>();
    const canvasWidth = ctx.canvas.width, canvasHeight = ctx.canvas.height;
    this.drawBackground = view.background || view.frame || ctx.canvas;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (view.background && name !== 'pause' && name !== 'continue' && view.fadeTime === undefined) ctx.drawImage(view.background, 0, 0, canvasWidth, canvasHeight);

    if (name === 'result') {
      const bindings = scene.bindings.LevelOverControl;
      const set = (key: string, value: any) => { if (bindings[key]?.fileID) texts.set(bindings[key].fileID, String(value)); };
      const level = view.info.level.match(/^(EZ|HD|IN|AT|SP)\s*(?:Lv\.)?\s*([\d.]+)/);
      set('scoreText', String(Math.round(view.stats.score)).padStart(7, '0'));
      set('percentText', view.stats.accuracy.toFixed(2).padStart(5, '0') + '%');
      set('maxComboText', view.stats.maxCombo);
      for (const stat of ['perfect', 'good', 'bad', 'miss', 'early', 'late'] as const) set(stat + 'Text', view.stats[stat] || 0);
      set('songsName', view.info.name); set('songsLevel', ''); set('songsDifficulty', (level?.[1] || 'IN') + '  Lv.' + Math.floor(Number(level?.[2] || 0)));
      set('best', view.stats.score > (view.previousBest || 0) ? `NEW BEST   ${String(view.previousBest || 0).padStart(7, '0')}  +${String(view.stats.score - (view.previousBest || 0)).padStart(7, '0')}` : '');
      set('collectedText', '已获得');
      const grade = resultGrade(view.stats);
      for (const node of Object.values(scene.nodes)) {
        if (node.path.includes('/Ratings/')) { if (node.name === grade) enabled.add(node.id); else hidden.add(node.id); }
        if (node.name === 'MirrorIcon' || node.name.includes('百鬼夜行')) hidden.add(node.id);
      }
      if (view.image) dynamicImages.set('14', view.image);
      const profile = scene.bindings.PlayerBarControl;
      texts.set(profile.playerId.fileID, view.settings.playerName);
      texts.set(profile.rank.fileID, view.settings.playerRks.toFixed(2));
      texts.set(profile.rankNumText.fileID, String(view.settings.playerChallengeModeRank % 100));
      const tier = view.settings.playerChallengeModeTier;
      for (const [index, id] of profile.rankBackgrounds.entries()) if (index === tier) enabled.add(String(id)); else hidden.add(String(id));
      if (view.settings.playerChallengeModeRank === 0) hidden.add('89');
      else enabled.add('89');
      const avatar = this.images.get('profile-' + avatarId(view.settings.playerAvatar)) || this.images.get('profile-OblivionPHIN');
      if (avatar) dynamicImages.set('100', avatar);
      // PlayerBarControl.Start @ 0x1d8c4c8: shift the name slider by -55-preferredWidth.
      const font = scene.nodes['94'].components.find(c => c.font)?.font!;
      ctx.font = `${font.m_FontSize}px PhiHUD`;
      // playerIdSlider points to RectTransform 287 (Image node 92), not its parent Slider.
      const slider = Object.values(scene.nodes).find(node => node.transformId === profile.playerIdSlider.fileID)!;
      patch(slider.id, { 'm_AnchoredPosition.x': view.showName === false ? 0 : -55 - ctx.measureText(view.settings.playerName).width });
      const sync = this.syncFrame(time), syncBindings = scene.bindings.AutoSyncControl;
      const syncRoot = Object.values(scene.nodes).find(node => node.components.some(component => component.id === syncBindings.animator.fileID))!;
      const progress = Object.values(scene.nodes).find(node => node.components.some(component => component.id === syncBindings.syncTextDisplay.fileID))!;
      const result = Object.values(scene.nodes).find(node => node.components.some(component => component.id === syncBindings.syncResult.fileID))!;
      texts.set(syncBindings.syncTextSize.fileID, '同步中'); texts.set(syncBindings.syncTextDisplay.fileID, '同步中'); texts.set(syncBindings.syncResult.fileID, '已同步');
      const syncFont = syncRoot.components.find(component => component.id === syncBindings.syncTextSize.fileID)!.font!;
      ctx.font = `${syncFont.m_FontSize}px PhiHUD`;
      patch(syncRoot.id, { 'm_SizeDelta.x': ctx.measureText('同步中').width });
      if (sync.phase === 'waiting' || sync.phase === 'hidden') hidden.add(syncRoot.id);
      else {
        // Animator transitions restore the children disabled by the initial SyncHide state.
        for (const id of syncRoot.children) patch(id, { m_IsActive: 1 });
        patch(result.id, { 'm_Color.a': 0 });
        patch(progress.parent!, { m_Alpha: 0 });
        for (const [id, values] of this.animate(scene, sync.clip, syncRoot.path, sync.time)) patch(id, values);
        if (sync.loopTime !== null) {
          const indicator = Object.values(scene.nodes).find(node => node.components.some(component => component.clips?.includes('Sync')))!;
          for (const [id, values] of this.animate(scene, 'Sync', indicator.path, sync.loopTime)) patch(id, values);
        }
      }
      if (!view.collection) hidden.add('57');
      else { enabled.add('57'); enabled.add('22'); for (const id of ['12', '46', '70']) hidden.add(id); texts.set(357, '1.00 MB'); texts.set(311, '已获得'); }
      for (const id of ['54', '20']) this.canvas(ctx, scene, id, patches, texts, dynamicImages, hidden, enabled, view, id === '54' ? (canvasWidth / canvasHeight >= 1.7778 ? .5 : 0) : .6);
    } else if (name === 'loading') {
      patch('34', { 'm_IsActive': 1 }); enabled.add('34');
      // StartAnimation remains in its fully visible loading pose until resources finish.
      const settle = Math.min(time, 4.5);
      for (const [id, values] of this.animate(scene, clip, rootPath, settle)) patches.set(id, values);
      if (view.fadeTime !== undefined) for (const [id, values] of this.animate(scene, 'StartInfoFadeOut', 'Canvas (1)/StartInfos', view.fadeTime)) patch(id, values);
      enabled.add('34');
      for (const id of ['92', '105', '113', '188', '210']) hidden.add(id);
      texts.set(scene.nodes['207'].components.find(c => c.font)!.id, view.info.name);
      texts.set(scene.nodes['14'].components.find(c => c.font)!.id, view.info.composer || '');
      texts.set(scene.nodes['59'].components.find(c => c.font)!.id, view.info.charter || '');
      texts.set(scene.nodes['163'].components.find(c => c.font)!.id, view.info.illustrator || '');
      texts.set(scene.nodes['72'].components.find(c => c.font)!.id, 'Tip: ' + (view.tip ?? this.activeTip));
      const difficulty = view.info.level.match(/^(EZ|HD|IN|AT|SP).*?(\d+(?:\.\d+)?)/);
      texts.set(scene.nodes['47'].components.find(c => c.font)!.id, String(Math.floor(Number(difficulty?.[2] || 0))));
      texts.set(scene.nodes['112'].components.find(c => c.font)!.id, difficulty?.[1] || 'IN');
      if (view.image) { dynamicImages.set('157', view.image); dynamicImages.set('11', view.image); }
      for (const [id, values] of this.animate(scene, 'Loading', 'Canvas (1)/StartInfos/StartAnimation/moreInfos/content/loading', (view.loadingTime ?? time) % this.duration('Loading'))) patch(id, values);
      this.canvas(ctx, scene, '154', patches, texts, dynamicImages, hidden, enabled, view, canvasWidth / canvasHeight < 16 / 9 ? 0 : .6);
    } else {
      const id = name === 'continue' ? '44' : '40'; enabled.add(id); enabled.add('17');
      this.canvas(ctx, scene, id, patches, texts, dynamicImages, hidden, enabled, view, .6);
    }
    ctx.restore();
  }

  async loadProfiles(asset: (path: string) => string): Promise<void> {
    const response = await fetch(asset('/assets/avatars/index.json'));
    if (!response.ok) throw new Error(`Avatar index: ${response.status}`);
    this.avatarEntries = await response.json();
    await this.loadAvatar('OblivionPHIN');
  }

  private canvas(ctx: CanvasRenderingContext2D, scene: Scene, root: string, patches: Map<string, Data>, texts: Map<number, string>, images: Map<string, CanvasImageSource>, hidden: Set<string>, enabled: Set<string>, view: SceneView, match: number): void {
    const width = ctx.canvas.width, height = ctx.canvas.height;
    const scale = (width / 1920) ** (1 - match) * (height / 1080) ** match;
    ctx.save(); ctx.translate(width / 2, height / 2); ctx.scale(scale, -scale);
    const rootNode = scene.nodes[root];
    for (const child of rootNode.children) this.node(ctx, scene, child, { x: width / scale, y: height / scale }, half, patches, texts, images, hidden, enabled, view);
    ctx.restore();
  }

  private node(ctx: CanvasRenderingContext2D, scene: Scene, id: string, parentSize: Vector, parentPivot: Vector, patches: Map<string, Data>, texts: Map<number, string>, images: Map<string, CanvasImageSource>, hidden: Set<string>, enabled: Set<string>, view: SceneView): void {
    const node = scene.nodes[id], patch = patches.get(id) || {};
    if (!node || hidden.has(id) || (patch.m_IsActive ?? (enabled.has(id) ? 1 : node.active ? 1 : 0)) < .5) return;
    const min = { ...(node.anchorMin || half) }, max = { ...(node.anchorMax || half) }, pos = { ...(node.anchoredPosition || node.position || { x: 0, y: 0 }) }, delta = { ...(node.sizeDelta || { x: 0, y: 0 }) }, scale = { ...node.scale };
    const pivot = node.pivot || half;
    for (const [key, target] of [['m_AnchorMin', min], ['m_AnchorMax', max], ['m_AnchoredPosition', pos], ['m_SizeDelta', delta], ['m_ScaleCurves', scale]] as const) {
      for (const axis of ['x', 'y'] as const) if (patch[key + '.' + axis] !== undefined) target[axis] = patch[key + '.' + axis];
    }
    const size = { x: parentSize.x * (max.x - min.x) + delta.x, y: parentSize.y * (max.y - min.y) + delta.y };
    const position = { x: (min.x + (max.x - min.x) * pivot.x - parentPivot.x) * parentSize.x + pos.x, y: (min.y + (max.y - min.y) * pivot.y - parentPivot.y) * parentSize.y + pos.y };
    ctx.save(); ctx.translate(position.x, position.y); ctx.scale(scale.x ?? 1, scale.y ?? 1);
    const group = node.components.find(c => c.classId === 225);
    if (group) ctx.globalAlpha *= patch.m_Alpha ?? group.data.m_Alpha;
    const graphic = node.components.find(c => c.data.m_Color && (c.font || c.points || c.data.m_Sprite !== undefined || c.data.m_Texture !== undefined));
    const local = new Path2D();
    if (graphic?.points?.length) {
      graphic.points.forEach((p, index) => { const x = p.x + (p.z! - pivot.x) * size.x, y = p.y + (p.w! - pivot.y) * size.y; if (index) local.lineTo(x, y); else local.moveTo(x, y); }); local.closePath();
    } else local.rect(-pivot.x * size.x, -pivot.y * size.y, size.x, size.y);
    const mask = node.components.find(c => c.data.m_ShowMaskGraphic !== undefined);
    const shadow = node.components.find(c => String(c.script).includes('LeTai.TrueShadow.dll') && c.data.m_Enabled);
    if (graphic && shadow && !graphic.font) this.shadow(ctx, local, graphic, shadow.data, size, pivot, patch);
    if (mask) ctx.clip(local);
    if (mask && graphic?.data.m_Type === 3 && graphic.data.m_FillMethod === 0) {
      const amount = patch.m_FillAmount ?? graphic.data.m_FillAmount, origin = patch.m_FillOrigin ?? graphic.data.m_FillOrigin;
      ctx.beginPath(); ctx.rect(-pivot.x * size.x + (origin >= .5 ? size.x * (1 - amount) : 0), -pivot.y * size.y, size.x * amount, size.y); ctx.clip();
    }
    // A stencil mask's white caster is fully covered by its image in Unity.
    // Filling it again under an antialiased Canvas clip exposes a white fringe.
    // Loading's world-space illustration is drawn on the mask node itself;
    // m_ShowMaskGraphic only controls its caster, never that dynamic image.
    const coveredMask = mask && node.children.some(child => images.has(child));
    if (graphic && (images.has(id) || !mask || mask.data.m_ShowMaskGraphic && !coveredMask)) {
      const data = graphic.data, tint = { ...(data.m_Color || white) };
      for (const channel of ['r', 'g', 'b', 'a']) tint[channel] = patch['m_Color.' + channel] ?? patch['color.' + channel] ?? tint[channel];
      ctx.save(); ctx.globalAlpha *= tint.a;
      const x = -pivot.x * size.x, y = -pivot.y * size.y;
      const dynamic = images.get(id), image = dynamic || this.sprite(graphic, tint);
      if (graphic.font) {
        if (shadow) {
          const scale = ctx.getTransform(), shadowColor = shadow.data.color;
          ctx.shadowColor = `rgba(${Math.round(shadowColor.r * 255)},${Math.round(shadowColor.g * 255)},${Math.round(shadowColor.b * 255)},${shadowColor.a})`;
          ctx.shadowBlur = shadow.data.size * Math.hypot(scale.a, scale.b) / 3;
        }
        this.text(ctx, graphic, texts.get(graphic.id) ?? data.m_Text ?? '', size, pivot, tint);
      }
      else if (data.source) {
        // TranslucentImage samples a separate source camera/snapshot rather than its own UI.
        const matrix = ctx.getTransform(); const shape = new Path2D(); shape.addPath(local, matrix);
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clip(shape);
        const vibrancy = patch.vibrancy ?? data.vibrancy ?? 1;
        const brightness = patch.brightness ?? data.brightness ?? .02;
        if (view.frame) ctx.drawImage(this.translucentFrame(view.frame, vibrancy, brightness), 0, 0, ctx.canvas.width, ctx.canvas.height);
        else ctx.drawImage(this.drawBackground, 0, 0, ctx.canvas.width, ctx.canvas.height);
      } else if (image) {
        if (graphic.points?.length) ctx.clip(local);
        if (data.m_Type === 3 && data.m_FillMethod === 0) {
          const fill = patch.m_FillAmount ?? data.m_FillAmount, origin = patch.m_FillOrigin ?? data.m_FillOrigin;
          ctx.beginPath(); ctx.rect(x + (origin >= .5 ? size.x * (1 - fill) : 0), y, size.x * fill, size.y); ctx.clip();
        }
        ctx.translate(x, y + size.y); ctx.scale(1, -1); ctx.drawImage(image, 0, 0, size.x, size.y);
      } else if (graphic.points?.length || data.m_Sprite !== undefined) { ctx.fillStyle = color(tint); ctx.fill(local); }
      ctx.restore();
    }
    if (['Resume', 'Retry', 'Back', 'PlayerBar'].includes(node.name)) {
      const screen = new Path2D(); screen.addPath(local, ctx.getTransform()); this.hitRegions.push({ name: node.name, path: screen });
    }
    for (const child of node.children) this.node(ctx, scene, child, size, pivot, patches, texts, images, hidden, enabled, view);
    ctx.restore();
  }

  private shadow(ctx: CanvasRenderingContext2D, shape: Path2D, graphic: Component, data: Data, size: Vector, pivot: Vector, patch: Data): void {
    const tint = data.color || { r: 0, g: 0, b: 0, a: .4 };
    const alpha = tint.a * (data.useCasterAlpha ? patch['m_Color.a'] ?? graphic.data.m_Color.a : 1);
    if (alpha <= 0) return;
    const key = JSON.stringify([size, pivot, graphic.points, data]);
    let cached = this.shadows.get(key);
    if (!cached) {
      const padding = Math.ceil(data.size * 2 + 8), x = -pivot.x * size.x - padding, y = -pivot.y * size.y - padding;
      const mask = document.createElement('canvas'); mask.width = Math.ceil(size.x + padding * 2); mask.height = Math.ceil(size.y + padding * 2);
      let out = mask.getContext('2d')!;
      out.translate(-x + (data.offset?.x || 0), -y + (data.offset?.y || 0));
      out.fillStyle = color(tint); out.fill(shape);
      const config = shadowBlurConfig(data.size);
      const image = efficientBlur(mask, config.radius, config.iteration);
      out = image.getContext('2d')!; out.translate(-x, -y);
      // TrueShadow/PostProcess alpha = blurredAlpha * (1 - imprintAlpha).
      out.globalAlpha = 1; out.globalCompositeOperation = 'destination-out'; out.fill(shape);
      cached = { image, x, y }; this.shadows.set(key, cached);
    }
    ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(cached.image, cached.x, cached.y); ctx.restore();
  }

  private text(ctx: CanvasRenderingContext2D, component: Component, text: string, size: Vector, pivot: Vector, tint: Data): void {
    if (!text) return;
    const font = component.font!;
    const face = font.m_Font?.guid === '6cfcbcc5519548242ae38c129dad9f1e' ? 'SceneHot' : 'PhiHUD';
    let pixels = font.m_FontSize || 32;
    ctx.font = `${pixels}px ${face}, sans-serif`;
    if (font.m_BestFit) {
      pixels = Math.max(font.m_MinSize || 1, Math.floor(pixels * Math.min(1, size.x / Math.max(1, ctx.measureText(text).width))));
      ctx.font = `${pixels}px ${face}, sans-serif`;
    }
    const alignment = font.m_Alignment || 0, horizontal = alignment % 3, vertical = Math.floor(alignment / 3);
    const x = -pivot.x * size.x + horizontal / 2 * size.x;
    const y = -(1 - pivot.y) * size.y + vertical / 2 * size.y;
    ctx.scale(1, -1); ctx.fillStyle = color(tint); ctx.textAlign = horizontal === 0 ? 'left' : horizontal === 1 ? 'center' : 'right';
    ctx.textBaseline = vertical === 0 ? 'top' : vertical === 1 ? 'middle' : 'bottom';
    const matrix = ctx.getTransform(), density = Math.abs(matrix.a);
    if (matrix.b || matrix.c || Math.abs(matrix.d - density) > .00001) { ctx.fillText(text, x, y); return; }
    const key = JSON.stringify([text, pixels * density, face, horizontal, vertical, tint.r, tint.g, tint.b]);
    let raster = this.textRasters.get(key);
    if (!raster) {
      const scratch = document.createElement('canvas'), factor = 4, font = `${pixels * density * factor}px ${face}, sans-serif`;
      let out = scratch.getContext('2d')!; out.font = font; out.textAlign = ctx.textAlign; out.textBaseline = ctx.textBaseline;
      const bounds = out.measureText(text), left = Math.floor(-bounds.actualBoundingBoxLeft / factor) - 2, top = Math.floor(-bounds.actualBoundingBoxAscent / factor) - 2;
      const width = Math.max(1, Math.ceil(bounds.actualBoundingBoxRight / factor) - left + 2), height = Math.max(1, Math.ceil(bounds.actualBoundingBoxDescent / factor) - top + 2);
      scratch.width = width * factor; scratch.height = height * factor;
      out = scratch.getContext('2d')!; out.font = font; out.textAlign = ctx.textAlign; out.textBaseline = ctx.textBaseline; out.fillStyle = color(tint);
      out.fillText(text, -left * factor, -top * factor);
      const image = document.createElement('canvas'); image.width = width; image.height = height;
      const target = image.getContext('2d')!; target.imageSmoothingQuality = 'high'; target.drawImage(scratch, 0, 0, width, height);
      raster = { image, left, top }; if (this.textRasters.size >= 512) this.textRasters.clear(); this.textRasters.set(key, raster);
    }
    const point = new DOMPoint(x, y).matrixTransform(matrix);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(raster.image, Math.round(point.x) + raster.left, Math.round(point.y) + raster.top);
  }
}
