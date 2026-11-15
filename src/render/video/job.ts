import { checkCancelled, yieldFrame } from './control';
import { type EncoderConfig, type ExportBackend, type FrameEncoder } from './types';

export async function renderVideo(
  backend: ExportBackend, config: EncoderConfig, canvas: HTMLCanvasElement,
  render: (time: number) => unknown, progress: (done: number) => void,
): Promise<{ blob: Blob; extension: FrameEncoder['extension'] }> {
  let encoder: FrameEncoder | undefined;
  try {
    checkCancelled(config.signal);
    const module = backend === 'ffmpeg' ? await import("./encoders/ffmpeg") : await import("./encoders/webcodecs");
    checkCancelled(config.signal);
    encoder = await module.createEncoder(config);
    config.status('渲染视频…');
    for (let index = 0; index < config.frames; index++) {
      checkCancelled(config.signal);
      await render(index / config.fps);
      checkCancelled(config.signal);
      await encoder.write(canvas, index);
      progress(index + 1);
      await yieldFrame();
    }
    checkCancelled(config.signal);
    config.status('封装中…');
    return { blob: await encoder.finish(), extension: encoder.extension };
  } finally {
    encoder?.close();
  }
}
