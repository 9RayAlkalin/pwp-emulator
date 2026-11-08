import { FFmpeg } from '@ffmpeg/ffmpeg';
import classWorkerURL from '@ffmpeg/ffmpeg/worker?worker&url';
import { checkCancelled, type EncoderConfig } from './types';

export async function loadFFmpeg(config: Pick<EncoderConfig, 'signal' | 'status'>, multi = false) {
  const ffmpeg = new FFmpeg(), { signal } = config;
  if (multi && !crossOriginIsolated) throw new Error('多线程编码需要跨源隔离，请先启用多线程模式并刷新页面');
  const core = new URL(multi ? 'assets/ffmpeg-mt/' : 'assets/ffmpeg/', new URL(import.meta.env.BASE_URL, document.baseURI));
  let closed = false, log = '';
  const close = () => {
    if (closed) return;
    closed = true; ffmpeg.terminate(); signal.removeEventListener('abort', close);
  };
  signal.addEventListener('abort', close, { once: true });
  ffmpeg.on('log', ({ message }) => { log = (log + '\n' + message).slice(-4000); });
  const execute = async (args: string[]) => {
    checkCancelled(signal); log = '';
    const result = await ffmpeg.exec(['-hide_banner', '-loglevel', 'error', '-filter_threads', '1', '-filter_complex_threads', '1', ...args]);
    checkCancelled(signal);
    if (result) throw new Error(`FFmpeg 编码失败（${result}）：${log.trim()}`);
  };
  try {
    checkCancelled(signal); config.status(multi ? '加载多线程 FFmpeg.wasm…' : '加载 FFmpeg.wasm…');
    await ffmpeg.load({ classWorkerURL, coreURL: new URL('ffmpeg-core.js', core).href, wasmURL: new URL('ffmpeg-core.wasm', core).href,
      ...(multi ? { workerURL: new URL('ffmpeg-core.worker.js', core).href } : {}),
    });
    checkCancelled(signal);
    return { ffmpeg, execute, close };
  } catch (error) { close(); checkCancelled(signal); throw error; }
}
