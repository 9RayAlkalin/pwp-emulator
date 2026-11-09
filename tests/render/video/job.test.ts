import { describe, expect, it, vi } from 'vitest';
import { renderVideo } from '../../../src/render/video/job';
import type { EncoderConfig, FrameEncoder } from '../../../src/render/video/types';

const factory = vi.hoisted(() => vi.fn());
vi.mock("../../../src/render/video/encoders/webcodecs", () => ({ createEncoder: factory }));

const config = (signal: AbortSignal): EncoderConfig => ({ width: 320, height: 180, fps: 30, frames: 3, bitrate: 1000000, signal, status: () => {} });

describe('fixed frame export job', () => {
  it('waits for encoding before advancing its clock or drawing another frame', async () => {
    const events: string[] = [], blob = new Blob(['video']);
    factory.mockResolvedValue({ extension: 'webm', async write(_, index) { await Promise.resolve(); events.push(`write:${index}`); }, async finish() { events.push('finish'); return blob; }, close() { events.push('close'); } } as FrameEncoder);
    const result = await renderVideo('webcodecs', config(new AbortController().signal), {} as HTMLCanvasElement, time => events.push(`draw:${Math.round(time * 30)}`), done => events.push(`progress:${done}`));
    expect(events).toEqual(['draw:0','write:0','progress:1','draw:1','write:1','progress:2','draw:2','write:2','progress:3','finish','close']);
    expect(result).toEqual({ blob, extension: 'webm' });
  });

  it('cancels between frames, releases the encoder and never finalizes a partial video', async () => {
    const abort = new AbortController(), write = vi.fn(), finish = vi.fn(), close = vi.fn();
    factory.mockResolvedValue({ extension: 'webm', write, finish, close });
    await expect(renderVideo('webcodecs', config(abort.signal), {} as HTMLCanvasElement, () => {}, () => abort.abort())).rejects.toThrow('已取消');
    expect(write).toHaveBeenCalledTimes(1); expect(finish).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
  });

  it('releases the encoder if drawing fails and can run another job afterwards', async () => {
    const close = vi.fn(); factory.mockResolvedValue({ extension: 'webm', close });
    await expect(renderVideo('webcodecs', config(new AbortController().signal), {} as HTMLCanvasElement, () => { throw new Error('draw failure'); }, () => {})).rejects.toThrow('draw failure');
    expect(close).toHaveBeenCalledOnce();
    factory.mockResolvedValue({ extension: 'webm', write: vi.fn(), finish: async () => new Blob(), close: vi.fn() });
    await expect(renderVideo('webcodecs', config(new AbortController().signal), {} as HTMLCanvasElement, () => {}, () => {})).resolves.toMatchObject({ extension: 'webm' });
  });
});
