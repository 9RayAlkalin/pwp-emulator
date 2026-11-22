import { loadFFmpeg } from './ffloader';
import { containerMime, encodingOptions, muxArguments, videoArguments } from '../options';
import { audioWav } from '../audio';
import { checkCancelled } from '../control';
import { type EncoderConfig, type FrameEncoder } from '../types';

// Bound uncompressed input instead of retaining every image in the Wasm filesystem.
export function ffmpegBatchFrames(width: number, height: number, fps: number): number {
  const frameBytes = width * height * 4, mib = 1024 * 1024;
  // A 4K frame alone is ~32 MiB. Allow up to four large frames per run
  // so we do not restart the codec and force a keyframe on every frame.
  const budget = frameBytes > 16 * mib ? Math.min(128 * mib, 4 * frameBytes) : 32 * mib;
  return Math.max(1, Math.min(fps * 2, Math.floor(budget / frameBytes)));
}

export async function createEncoder(config: EncoderConfig): Promise<FrameEncoder> {
  const options = encodingOptions(config.encoding);
  if (options.codec === 'vp9') throw new Error('此 Wasm 核心的 VP9 编码不稳定，请使用 WebCodecs 的 VP9 选项');
  if (options.audioCodec === 'opus') throw new Error('此 Wasm 核心的 Opus 编码不稳定，请改用 AAC、FLAC、PCM 或 WebCodecs');
  const multi = options.threading === 'multi' || options.threading === 'auto' && options.codec === 'hevc' && crossOriginIsolated;
  if (options.codec === 'hevc' && !multi) throw new Error('HEVC 软编码需要多线程 FFmpeg；请启用多线程模式并刷新，或改用 WebCodecs HEVC');
  if (!multi) options.threads = 1;
  const { ffmpeg, execute, close } = await loadFFmpeg(config, multi);
  const { width, height, fps, signal } = config;
  try {
    const capacity = ffmpegBatchFrames(width, height, fps), frameBytes = width * height * 4;
    let batch = new Uint8Array(0), buffered = 0, written = 0;
    const parts: { name: string; frames: number }[] = [];
    let pending: Promise<void> | undefined;
    let failure: { error: unknown } | undefined;
    const check = () => {
      checkCancelled(signal);
      if (failure) throw failure.error;
    };
    const drain = async () => {
      await pending;
      pending = undefined;
      check();
    };
    const submit = async () => {
      if (!buffered) return;
      // Keep one batch in FFmpeg and at most one in the renderer. Only the
      // active batch owns the worker's input file.
      await drain();
      const count = buffered, name = `part-${String(parts.length).padStart(6, '0')}.${options.container}`;
      const input = count * frameBytes === batch.length ? batch : batch.subarray(0, count * frameBytes);
      buffered = 0;
      batch = new Uint8Array(0);
      config.status(`FFmpeg 编码 ${written - count + 1}–${written} 帧…`);
      pending = (async () => {
        await ffmpeg.writeFile('frames.rgba', input);
        await execute(['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`, '-framerate', String(fps), '-i', 'frames.rgba',
          '-an', '-frames:v', String(count), ...videoArguments(options, fps, config.bitrate), name]);
        await ffmpeg.deleteFile('frames.rgba');
        parts.push({ name, frames: count });
      })().catch(error => { failure = { error }; });
    };
    return {
      extension: options.container,
      async write(canvas, index) {
        check();
        if (index !== written) throw new Error('FFmpeg 帧顺序不连续');
        if (index >= config.frames) throw new Error('FFmpeg 帧数超出导出范围');
        if (!batch.length && capacity > 1) batch = new Uint8Array(Math.min(capacity, config.frames - written) * frameBytes);
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
        if (capacity === 1) batch = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
        else batch.set(pixels, buffered * frameBytes);
        buffered++; written++;
        if (buffered === capacity) await submit();
      },
      async finish() {
        await submit(); await drain();
        config.status('FFmpeg 合并视频和音轨…');
        const list = 'ffconcat version 1.0\n' + parts.map(part => `file '${part.name}'\nduration ${part.frames / fps}\n`).join('');
        await ffmpeg.writeFile('parts.txt', new TextEncoder().encode(list));
        const args = ['-f', 'concat', '-safe', '0', '-i', 'parts.txt'];
        if (config.audio) { await ffmpeg.writeFile('audio.wav', audioWav(config.audio)); args.push('-i', 'audio.wav'); }
        const output = `output.${options.container}`;
        args.push(...muxArguments(options, !!config.audio, config.frames / fps, output));
        await execute(args);
        const data = await ffmpeg.readFile(output);
        if (typeof data === 'string') throw new Error('FFmpeg 输出格式错误');
        return new Blob([new Uint8Array(data)], { type: containerMime[options.container] });
      },
      close,
    };
  } catch (error) {
    close(); checkCancelled(signal); throw error;
  }
}
