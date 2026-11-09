import { audioWav } from '../audio';
import { loadFFmpeg } from '../encoders/ffloader';
import type { EncoderConfig } from '../types';

// H.264/HEVC pixels are encoded by WebCodecs; FFmpeg only copies the video stream.
export async function muxBrowserMP4(chunks: Uint8Array[], codec: string, config: EncoderConfig): Promise<Blob> {
  const { ffmpeg, execute, close } = await loadFFmpeg(config);
  try {
    config.status('封装浏览器编码的 MP4…');
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    chunks.length = 0;
    const input = codec === 'hevc' ? 'hevc' : 'h264';
    await ffmpeg.writeFile(`video.${input}`, bytes);
    const args = ['-r', String(config.fps), '-f', input, '-i', `video.${input}`];
    if (config.audio) { await ffmpeg.writeFile('audio.wav', audioWav(config.audio)); args.push('-i', 'audio.wav'); }
    args.push('-map', '0:v:0', '-c:v', 'copy');
    if (codec === 'hevc') args.push('-tag:v', 'hvc1');
    if (config.audio) args.push('-map', '1:a:0', '-c:a', 'aac', '-b:a', `${config.encoding?.audioBitrate || 192}k`); else args.push('-an');
    args.push('-t', String(config.frames / config.fps), '-movflags', '+faststart', 'output.mp4');
    await execute(args);
    const data = await ffmpeg.readFile('output.mp4');
    if (typeof data === 'string') throw new Error('MP4 输出格式错误');
    return new Blob([new Uint8Array(data)], { type: 'video/mp4' });
  } finally { close(); }
}
