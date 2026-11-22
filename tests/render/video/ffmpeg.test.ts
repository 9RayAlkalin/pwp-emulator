import { describe, expect, it, vi } from 'vitest';
import { createEncoder, ffmpegBatchFrames } from '../../../src/render/video/encoders/ffmpeg';
import type { EncoderConfig } from '../../../src/render/video/types';

const loadFFmpeg = vi.hoisted(() => vi.fn());
vi.mock('../../../src/render/video/encoders/ffloader', () => ({ loadFFmpeg }));

function setup() {
  const abort = new AbortController();
  const config: EncoderConfig = {
    width: 2, height: 2, fps: 1, frames: 5, bitrate: 1000000,
    signal: abort.signal, status: () => {},
  };
  let pixel = 0;
  const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(16).fill(++pixel) }));
  const canvas = { getContext: () => ({ getImageData }) } as unknown as HTMLCanvasElement;
  const ffmpeg = {
    writeFile: vi.fn(async (_name: string, _data: Uint8Array) => {}),
    deleteFile: vi.fn(async (_name: string) => {}),
    readFile: vi.fn(async () => new Uint8Array([1])),
  };
  const execute = vi.fn(async (_args: string[]) => {});
  loadFFmpeg.mockResolvedValue({ ffmpeg, execute, close: vi.fn() });
  return { abort, config, canvas, getImageData, ffmpeg, execute };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

describe('FFmpeg batch pipeline', () => {
  it('groups 4K frames without growing ordinary batches or exceeding the large-frame budget', () => {
    expect(ffmpegBatchFrames(1920, 1080, 60)).toBe(4);
    expect(ffmpegBatchFrames(3840, 2160, 120)).toBe(4);
    expect(ffmpegBatchFrames(3840, 2160, 1)).toBe(2);
    expect(ffmpegBatchFrames(4096, 4096, 120)).toBe(2);
  });

  it('gathers the next batch during encoding and drains full and partial batches in order before muxing', async () => {
    const { config, canvas, getImageData, ffmpeg, execute } = setup();
    const first = deferred(), tail = deferred();
    execute.mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined).mockReturnValueOnce(tail.promise);
    const encoder = await createEncoder(config);
    try {
      await encoder.write(canvas, 0);
      await encoder.write(canvas, 1);
      await encoder.write(canvas, 2);
      const secondBatch = encoder.write(canvas, 3);
      expect(getImageData).toHaveBeenCalledTimes(4);
      expect(ffmpeg.writeFile).toHaveBeenCalledTimes(1);
      expect(ffmpeg.deleteFile).not.toHaveBeenCalled();
      first.resolve();
      await secondBatch;

      await encoder.write(canvas, 4);
      const finishing = encoder.finish();
      await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
      expect(ffmpeg.readFile).not.toHaveBeenCalled();
      expect(ffmpeg.writeFile.mock.calls.map(([name, data]) => [name, [...data].filter((_, index) => index % 16 === 0)])).toEqual([
        ['frames.rgba', [1, 2]], ['frames.rgba', [3, 4]], ['frames.rgba', [5]],
      ]);
      tail.resolve();
      await expect(finishing).resolves.toMatchObject({ size: 1 });
      expect(execute.mock.calls.map(([args]) => args.at(-1))).toEqual([
        'part-000000.mp4', 'part-000001.mp4', 'part-000002.mp4', 'output.mp4',
      ]);
      expect(new TextDecoder().decode(ffmpeg.writeFile.mock.calls[3][1])).toBe(
        "ffconcat version 1.0\nfile 'part-000000.mp4'\nduration 2\nfile 'part-000001.mp4'\nduration 2\nfile 'part-000002.mp4'\nduration 1\n",
      );
    } finally { encoder.close(); }
  });

  it.each(['failure', 'abort'])('never submits the waiting batch or muxes after %s', async mode => {
    const { abort, config, canvas, ffmpeg, execute } = setup();
    const first = deferred();
    execute.mockReturnValueOnce(first.promise);
    const encoder = await createEncoder(config);
    try {
      await encoder.write(canvas, 0);
      await encoder.write(canvas, 1);
      await encoder.write(canvas, 2);
      const result = expect(encoder.finish()).rejects.toThrow(mode === 'abort' ? '已取消' : 'worker failed');
      if (mode === 'abort') abort.abort();
      first.reject(new Error('worker failed'));
      await result;
      expect(ffmpeg.writeFile).toHaveBeenCalledTimes(1);
      expect(ffmpeg.readFile).not.toHaveBeenCalled();
    } finally { encoder.close(); }
  });
});
