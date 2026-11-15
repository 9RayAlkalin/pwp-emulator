import { afterEach, expect, it, vi } from 'vitest';
import { NoteCommands, NoteLayer, replayNotes } from '../../src/render/notelayer';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('records clip, alpha and sprite transforms and replays in the authored order', () => {
  const batch = new NoteCommands(), image = {} as CanvasImageSource, context = batch.context;
  context.save(); context.beginPath(); context.rect(0, 0, 100, 100); context.clip();
  context.globalAlpha = .5;
  context.drawCenterRotateImage(image, 10, 20, 30, 40, 90, 10, -1);
  context.restore();
  const calls: any[] = [];
  const output = new Proxy({}, {
    get: (_, name) => (...args: any[]) => calls.push([name, ...args]),
    set: (_, name, value) => { calls.push([name, value]); return true; }
  }) as CanvasRenderingContext2D;
  replayNotes(output, batch.commands, batch.images);
  expect(calls.slice(0, 5)).toEqual([['save'], ['beginPath'], ['rect', 0, 0, 100, 100], ['clip'], ['globalAlpha', .5]]);
  expect(calls).toContainEqual(['scale', 1, -1]);
  expect(calls).toContainEqual(['drawImage', image, -15, -20, 30, 40]);
  expect(calls.at(-1)).toEqual(['restore']);
});

function setup() {
  const workers: any[] = [], copies: any[] = [];
  vi.stubGlobal('OffscreenCanvas', class {});
  vi.stubGlobal('Worker', class {
    onmessage: any; onerror: any; messages: any[] = []; terminate = vi.fn();
    constructor() { workers.push(this); }
    postMessage(data: any) { this.messages.push(data); }
  });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => { const image = { close: vi.fn() }; copies.push(image); return image; }));
  const batch = new NoteCommands(); batch.context.drawCenterRotateImage({} as CanvasImageSource, 0, 0, 10, 10, 0);
  return { workers, copies, batch };
}

it('uploads sprites once, returns exact frame images and closes unsolicited replies', async () => {
  const { workers, copies, batch } = setup(), layer = new NoteLayer();
  const first = layer.draw(batch, 100, 100); await vi.waitFor(() => expect(workers[0].messages.at(-1).type).toBe('frame'));
  const image = { close: vi.fn() }, worker = workers[0];
  worker.onmessage({ data: { id: worker.messages.at(-1).id, image } });
  expect(await first).toBe(image); expect(copies).toHaveLength(1);
  const second = layer.draw(batch, 200, 100); await Promise.resolve();
  expect(copies).toHaveLength(1);
  const stale = { close: vi.fn() }; worker.onmessage({ data: { id: -1, image: stale } }); expect(stale.close).toHaveBeenCalledOnce();
  worker.onmessage({ data: { id: worker.messages.at(-1).id, image } }); await second;
  layer.reset(); expect(worker.terminate).toHaveBeenCalledOnce();
});

it('resolves worker failure as replay fallback and disables further requests until reset', async () => {
  const { workers, batch } = setup(), layer = new NoteLayer();
  const pending = layer.draw(batch, 100, 100);
  await vi.waitFor(() => expect(workers[0].messages.at(-1).type).toBe('frame'));
  workers[0].onerror(); expect(await pending).toBeUndefined();
  expect(layer.supported()).toBe(false);
  layer.reset(); expect(layer.supported()).toBe(true);
});
