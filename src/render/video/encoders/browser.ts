import type { EncoderConfig } from '../types';

export async function browserVideoConfig(config: EncoderConfig): Promise<{ name: string; config: VideoEncoderConfig }> {
  const candidates = config.browserCodec && config.browserCodec !== 'auto' ? [config.browserCodec] : ['vp9', 'vp8', 'h264', 'hevc'];
  const codecs = { vp9: 'vp09.00.10.08', vp8: 'vp8', h264: 'avc1.640033', hevc: 'hvc1.1.6.L153.B0' };
  for (const name of candidates) {
    const options: VideoEncoderConfig = {
      codec: codecs[name], width: config.width, height: config.height, framerate: config.fps,
      bitrate: config.bitrate, hardwareAcceleration: config.hardwareAcceleration || 'no-preference',
      latencyMode: 'realtime', ...(name === 'h264' ? { avc: { format: 'annexb' as const } } : {}),
      ...(name === 'hevc' ? { hevc: { format: 'annexb' } } : {}),
    };
    try { if ((await VideoEncoder.isConfigSupported(options)).supported) return { name, config: options }; }
    catch { /* Probe the next browser codec with the same hardware preference. */ }
  }
  throw new Error('浏览器没有支持所选编码器和硬件偏好的配置；可改为自动、软件或 FFmpeg.wasm');
}

export async function browserCapabilities(width: number, height: number, fps: number, hardware: HardwareAcceleration): Promise<string[]> {
  if (typeof VideoEncoder !== 'function') return [];
  const supported: string[] = [];
  for (const browserCodec of ['h264', 'hevc', 'vp9', 'vp8'] as const) {
    try {
      await browserVideoConfig({ width, height, fps, frames: 1, bitrate: 5000000, hardwareAcceleration: hardware, browserCodec, signal: new AbortController().signal, status: () => {} });
      supported.push(browserCodec);
    } catch { /* Unavailable at this resolution and hardware preference. */ }
  }
  return supported;
}
