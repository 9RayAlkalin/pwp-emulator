import { webm_writer } from '../containers/webm';
import { checkCancelled, yieldFrame } from '../control';
import { type EncoderConfig, type FrameEncoder } from '../types';
import { browserVideoConfig } from './browser';

async function waitEncoder(encoder: VideoEncoder | AudioEncoder, signal: AbortSignal) {
  while (encoder.encodeQueueSize > 8) { checkCancelled(signal); await yieldFrame(); }
}

/* Opus 编码：20ms 一帧（960 样点）。时间戳从 0 起（与视频同源）。
   decoderConfig.description 就是 OpusHead，留作 CodecPrivate；没有就手搓兜底。 */
const opus_head_fallback = channels => {
    const b = new Uint8Array(19);
    b.set(new TextEncoder().encode("OpusHead"), 0);
    b[8] = 1;                                        // version
    b[9] = channels;
    const dv = new DataView(b.buffer);
    dv.setUint16(10, 312, true);                     // pre-skip（libopus 默认 6.5ms）
    dv.setUint32(12, 48000, true);                   // 原始采样率
    dv.setUint16(16, 0, true);                       // 输出增益
    b[18] = 0;                                       // 声道映射族 = 0（单流）
    return b;
};

const encode_audio_48k = async (rendered: AudioBuffer, signal: AbortSignal, bitrate: number) => {
    const chunks: EncodedAudioChunk[] = [];
    const out: { desc: Uint8Array | null; error: unknown; channels: number } = { desc: null, error: null, channels: rendered.numberOfChannels };
    const enc = new AudioEncoder({
        output: (chunk, meta) => {
            const d = meta && meta.decoderConfig && meta.decoderConfig.description;
            if (d && !out.desc) out.desc = ArrayBuffer.isView(d)
                ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice() : new Uint8Array(d).slice();
            chunks.push(chunk);
        },
        error: e => { out.error = e; }
    });
    const close = () => { if (enc.state !== 'closed') enc.close(); };
    signal.addEventListener('abort', close, { once: true });
    try {
    checkCancelled(signal);
    enc.configure({
        codec: "opus", sampleRate: 48000,
        numberOfChannels: out.channels, bitrate
    });
    const FRAME = 960;                               // 20ms @48k
    const planes: Float32Array[] = [];
    for (let c = 0; c < out.channels; c++) planes.push(rendered.getChannelData(c));
    let n_chunk = 0;
    for (let pos = 0; pos < rendered.length; pos += FRAME) {
        checkCancelled(signal);
        if (out.error) break;
        const n = Math.min(FRAME, rendered.length - pos);
        const planar = new Float32Array(n * out.channels);
        for (let c = 0; c < out.channels; c++) {
            planar.set(planes[c].subarray(pos, pos + n), c * n);
        }
        const ad = new AudioData({
            format: "f32-planar", sampleRate: 48000,
            numberOfFrames: n, numberOfChannels: out.channels,
            timestamp: Math.round(pos / 48000 * 1e6), data: planar
        });
        enc.encode(ad);
        ad.close();
        n_chunk++;
        if ((n_chunk & 127) === 0) await yieldFrame();   // 长曲也别把主线程焊住
        if (enc.encodeQueueSize > 16) await waitEncoder(enc, signal);
    }
    await enc.flush().catch(e => { out.error = out.error || e; });
    checkCancelled(signal);
    chunks.sort((a, b) => a.timestamp - b.timestamp);
    return { chunks, desc: out.desc, error: out.error, channels: out.channels };
    } finally { signal.removeEventListener('abort', close); close(); }
};

export async function createEncoder(config: EncoderConfig): Promise<FrameEncoder> {
    if (typeof VideoEncoder !== 'function') throw new Error('此浏览器不支持 WebCodecs，请选择 FFmpeg.wasm');
    const { width, height, fps, bitrate, signal } = config;
    const selected = await browserVideoConfig(config);
    const mp4 = selected.name === 'h264' || selected.name === 'hevc';
    const audio: EncodedAudioChunk[] = [];
    let audioMeta: { channels: number; codec_private: Uint8Array; codec_delay_ns: number } | null = null;
    if (config.audio && !mp4) {
        if (typeof AudioEncoder !== 'function') throw new Error('此浏览器不支持音频编码，请选择 FFmpeg.wasm');
        config.status('编码音频…');
        const result = await encode_audio_48k(config.audio, signal, (config.encoding?.audioBitrate || 192) * 1000);
        if (result.error) throw result.error;
        const head = result.desc || opus_head_fallback(result.channels);
        const preskip = head[10] | head[11] << 8;
        audioMeta = { channels: result.channels, codec_private: head, codec_delay_ns: Math.round(preskip / 48000 * 1e9) };
        audio.push(...result.chunks);
    }
    checkCancelled(signal);
    const writer = mp4 ? null : webm_writer({ width, height, video_codec: selected.name === 'vp9' ? 'V_VP9' : 'V_VP8', frame_ns: Math.round(1e9 / fps), audio: audioMeta, duration_ms: config.frames / fps * 1000 });
    const chunks: Uint8Array[] = [];
    let error: unknown;
    const encoder = new VideoEncoder({
        output: chunk => {
            if (mp4) { const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes); chunks.push(bytes); }
            else {
                while (audio.length && audio[0].timestamp <= chunk.timestamp) writer!.add_audio(audio.shift());
                writer!.add_video(chunk);
            }
        },
        error: value => { error = value; },
    });
    encoder.configure(selected.config);
    const close = () => { if (encoder.state !== 'closed') encoder.close(); signal.removeEventListener('abort', close); };
    signal.addEventListener('abort', close, { once: true });
    return {
        extension: mp4 ? 'mp4' : 'webm',
        async write(canvas, index) {
            checkCancelled(signal); if (error) throw error;
            const frame = new VideoFrame(canvas, { timestamp: Math.round(index * 1e6 / fps), duration: Math.round(1e6 / fps), alpha: 'discard' });
            try { encoder.encode(frame, { keyFrame: index % Math.max(1, Math.round(fps * (config.encoding?.keyframeSeconds || 2))) === 0 }); } finally { frame.close(); }
            await waitEncoder(encoder, signal);
        },
        async finish() {
            await encoder.flush(); checkCancelled(signal); if (error) throw error;
            if (mp4) return (await import("../containers/mp4")).muxBrowserMP4(chunks, selected.name, config);
            while (audio.length) writer!.add_audio(audio.shift());
            return writer!.finish();
        },
        close,
    };
}

