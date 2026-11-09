export const videoFormats = {
  h264: { encoder: 'libx264', containers: ['mp4', 'mkv'], pixels: ['yuv420p', 'yuv444p', 'yuv420p10le', 'yuv444p10le'] },
  hevc: { encoder: 'libx265', containers: ['mp4', 'mkv'], pixels: ['yuv420p', 'yuv444p', 'yuv420p10le', 'yuv444p10le'] },
  vp9: { encoder: 'libvpx-vp9', containers: ['webm', 'mkv'], pixels: ['yuv420p', 'yuv444p'] },
  prores: { encoder: 'prores_ks', containers: ['mov'], pixels: ['yuv422p10le'] },
  ffv1: { encoder: 'ffv1', containers: ['mkv'], pixels: ['bgr0'] },
} as const;

export type FFmpegCodec = keyof typeof videoFormats;
export type Container = 'mp4' | 'mkv' | 'webm' | 'mov';
export type SpeedPreset = 'ultrafast' | 'veryfast' | 'fast' | 'medium' | 'slow' | 'veryslow';
export interface EncodingOptions {
  codec: FFmpegCodec; container: Container; rateControl: 'crf' | 'bitrate'; crf: number;
  preset: SpeedPreset; pixelFormat: string; proresProfile: number; audioBitrate: number;
  audioCodec: 'auto' | 'aac' | 'opus' | 'flac' | 'pcm';
  keyframeSeconds: number;
  threading: 'auto' | 'single' | 'multi'; threads: number;
}
export type BrowserCodec = 'auto' | 'h264' | 'hevc' | 'vp9' | 'vp8';

export const defaultEncoding: EncodingOptions = {
  codec: 'h264', container: 'mp4', rateControl: 'crf', crf: 20, preset: 'ultrafast',
  pixelFormat: 'yuv420p', proresProfile: 2, audioBitrate: 192, audioCodec: 'auto', keyframeSeconds: 2,
  threading: 'auto', threads: 2,
};

export function encodingOptions(value: Partial<EncodingOptions> = {}): EncodingOptions {
  const options = { ...defaultEncoding, ...value };
  if (!(options.codec in videoFormats)) throw new Error('未知的视频编码器');
  const format = videoFormats[options.codec];
  if (!(format.containers as readonly string[]).includes(options.container)) throw new Error(`${options.codec} 不支持 ${options.container} 容器`);
  if (!(format.pixels as readonly string[]).includes(options.pixelFormat)) throw new Error(`${options.codec} 不支持 ${options.pixelFormat} 像素格式`);
  if (!['ultrafast', 'veryfast', 'fast', 'medium', 'slow', 'veryslow'].includes(options.preset)) throw new Error('未知的速度预设');
  options.crf = Math.min(options.codec === 'vp9' ? 63 : 51, Math.max(0, Number.isFinite(options.crf) ? options.crf : 20));
  options.proresProfile = Math.round(Math.max(0, Math.min(3, options.proresProfile)));
  options.audioBitrate = Math.max(32, Math.min(512, options.audioBitrate));
  options.keyframeSeconds = Math.max(.1, Math.min(30, options.keyframeSeconds));
  options.threads = Math.round(Math.max(1, Math.min(8, options.threads)));
  const compatibleAudio = options.container === 'mp4' ? ['auto', 'aac'] : options.container === 'webm' ? ['auto', 'opus']
    : options.container === 'mov' ? ['auto', 'aac', 'pcm'] : ['auto', 'aac', 'opus', 'flac', 'pcm'];
  if (!compatibleAudio.includes(options.audioCodec)) throw new Error(`${options.container} 不支持所选音频编码`);
  return options;
}

export function videoArguments(options: EncodingOptions, fps: number, bitrate: number): string[] {
  const args = ['-c:v', videoFormats[options.codec].encoder, '-threads', String(options.threads)];
  if (options.codec === 'h264' || options.codec === 'hevc') {
    args.push('-preset', options.preset, '-bf', '0', ...(options.rateControl === 'crf' ? ['-crf', String(options.crf)] : ['-b:v', String(bitrate)]));
    if (options.codec === 'hevc') args.push('-x265-params', `pools=none:frame-threads=${options.threads}:wpp=0:log-level=error`);
  } else if (options.codec === 'vp9') {
    const speeds: Record<SpeedPreset, number> = { ultrafast: 8, veryfast: 6, fast: 4, medium: 2, slow: 1, veryslow: 0 };
    args.push('-deadline', 'good', '-cpu-used', String(speeds[options.preset]), '-b:v', options.rateControl === 'crf' ? '0' : String(bitrate));
    args.push('-profile:v', options.pixelFormat === 'yuv444p' ? '1' : '0');
    if (options.rateControl === 'crf') args.push('-crf', String(options.crf));
  } else if (options.codec === 'prores') args.push('-profile:v', String(options.proresProfile));
  else args.push('-level', '3', '-coder', '1', '-context', '1', '-slicecrc', '1');
  args.push('-pix_fmt', options.pixelFormat, '-g', String(Math.max(1, Math.round(fps * options.keyframeSeconds))));
  if (options.container === 'mp4' || options.container === 'mov') args.push('-video_track_timescale', String(fps * 1000));
  if (options.codec === 'hevc' && options.container === 'mp4') args.push('-tag:v', 'hvc1');
  return args;
}

export function muxArguments(options: EncodingOptions, audio: boolean, duration: number, output: string): string[] {
  const args = ['-map', '0:v:0', '-c:v', 'copy'];
  if (audio) {
    const codec = options.audioCodec === 'auto' ? options.container === 'webm' ? 'opus' : options.container === 'mov' ? 'pcm' : 'aac' : options.audioCodec;
    args.push('-map', '1:a:0', '-c:a', { aac: 'aac', opus: 'libopus', flac: 'flac', pcm: 'pcm_s16le' }[codec]);
    if (codec === 'aac' || codec === 'opus') args.push('-b:a', `${options.audioBitrate}k`);
  } else args.push('-an');
  if (options.codec === 'hevc' && options.container === 'mp4') args.push('-tag:v', 'hvc1');
  if (options.container === 'mp4' || options.container === 'mov') args.push('-movflags', '+faststart');
  args.push('-t', String(duration), output);
  return args;
}

export const containerMime: Record<Container, string> = { mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', mov: 'video/quicktime' };
