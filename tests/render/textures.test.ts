import { afterEach, expect, it, vi } from 'vitest';
import { ChartTextures, grayscaleFilter, textureFrame, textureIsVisible, textureResolution } from '../../src/render/textures';

afterEach(() => vi.unstubAllGlobals());

const frames = { duration: .6, frames: [{ image: {} as CanvasImageSource, end: .1 }, { image: {} as CanvasImageSource, end: .6 }] };
it('selects GIF frames by duration and rewinds deterministically, including negative time', () => {
  expect(textureFrame(frames, 0)).toBe(0);
  expect(textureFrame(frames, .2)).toBe(1);
  expect(textureFrame(frames, .65)).toBe(0);
  expect(textureFrame(frames, .05)).toBe(0);
  expect(textureFrame(frames, -.2)).toBe(1);
});
it('addresses the first and last GIF frames by explicit progress, looping outside the unit interval', () => {
  expect(textureFrame(frames, 100, 0)).toBe(0);
  expect(textureFrame(frames, 100, 1)).toBe(1);
  expect(textureFrame(frames, 0, 1.25)).toBe(0);
  expect(textureFrame(frames, 0, -.25)).toBe(1);
});

function mockImages(width = 1024, height = 1024) {
  const canvases: any[] = [], bitmap = { width, height, close: vi.fn() };
  const decode = vi.fn(async () => bitmap);
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('document', { createElement: () => {
    const context = { globalCompositeOperation: 'source-over', fillStyle: '', drawImage: vi.fn(), fillRect: vi.fn() };
    const canvas = { width: 300, height: 150, getContext: () => context };
    canvases.push(canvas); return canvas;
  } });
  return { canvases, bitmap, decode };
}

it('shares one decoded source and tinted result across aliases, lines and chart times', async () => {
  const { canvases, bitmap, decode } = mockImages();
  const blob = new Blob(['png']), textures = await ChartTextures.load({ 'one.png': blob, 'alias.png': blob });
  expect(decode).toHaveBeenCalledTimes(1);
  expect(textures.dimensions('one.png')).toMatchObject({ width: 1024, height: 1024 });
  expect(textures.get('one.png', 0, undefined, 'rgb(255,255,255)')!.image).toBe(bitmap);
  expect(canvases).toHaveLength(0);
  const first = textures.get('one.png', 0, undefined, 'rgb(120,180,220)')!;
  for (let i = 0; i < 100; i++) expect(textures.get('alias.png', i, undefined, 'rgb(120,180,220)')!.image).toBe(first.image);
  expect(canvases).toHaveLength(1);
  expect(canvases[0].getContext().drawImage).toHaveBeenCalledTimes(2);
  const other = textures.get('one.png', 1, undefined, 'rgb(220,180,120)')!;
  expect(other.image).not.toBe(first.image); // Changing a different line's tint cannot mutate this image.
  expect((first.image as HTMLCanvasElement).width).toBe(1024);
  textures.dispose();
  expect(bitmap.close).toHaveBeenCalledTimes(1);
  expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
});

it('evicts least recently used variants at the pixel budget and releases their backing stores', async () => {
  mockImages(4096, 4096);
  const textures = await ChartTextures.load({ 'big.png': new Blob(['png']) });
  const a = textures.get('big.png', 0, undefined, 'rgb(10,20,30)')!.image as HTMLCanvasElement;
  const b = textures.get('big.png', 0, undefined, 'rgb(20,30,40)')!.image as HTMLCanvasElement;
  expect(textures.get('big.png', 1, undefined, 'rgb(10,20,30)')!.image).toBe(a);
  const c = textures.get('big.png', 0, undefined, 'rgb(30,40,50)')!.image as HTMLCanvasElement;
  expect(b.width).toBe(0); expect(b.height).toBe(0);
  expect(a.width).toBe(4096); expect(c.width).toBe(4096);
  textures.dispose(); expect(a.width).toBe(0); expect(c.width).toBe(0);
});

it('draws many distinct 4K grey layers without thrashing full-resolution tint caches', async () => {
  const { bitmap, canvases } = mockImages(3840, 2160);
  const blobs = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`layer${i}.png`, new Blob([String(i)])]));
  const textures = await ChartTextures.load(blobs);
  for (let frame = 0; frame < 3; frame++) for (let i = 0; i < 17; i++) {
    const image = textures.get(`layer${i}.png`, frame / 60, undefined, 'rgb(128,128,128)', true)!;
    expect(image.image).toBe(bitmap);
    expect(image).toMatchObject({ width: 3840, height: 2160, filter: `brightness(${128 / 255})` });
  }
  expect(canvases).toHaveLength(0);
  // Callers without Canvas filter support retain the existing fallback.
  expect(textures.get('layer0.png', 0, undefined, 'rgb(128,128,128)')!.filter).toBeUndefined();
  expect(canvases).toHaveLength(1);
  textures.dispose();
});

it('selects only exact grayscale colours for draw-time brightness', () => {
  expect(grayscaleFilter('rgb(0,0,0)')).toBe('brightness(0)');
  expect(grayscaleFilter('rgb(255,255,255)')).toBe('brightness(1)');
  expect(grayscaleFilter('rgb(128,127,128)')).toBeUndefined();
  expect(grayscaleFilter('rgb(256,256,256)')).toBeUndefined();
  expect(grayscaleFilter(undefined)).toBeUndefined();
});

it('reuses a scratch surface for oversized textures instead of retaining many full-size colour copies', async () => {
  const { canvases } = mockImages(6000, 6000);
  const textures = await ChartTextures.load({ 'huge.png': new Blob(['png']) });
  const a = textures.get('huge.png', 0, undefined, 'rgb(1,2,3)')!.image;
  expect(textures.get('huge.png', 1, undefined, 'rgb(1,2,3)')!.image).toBe(a);
  expect(canvases[0].getContext().drawImage).toHaveBeenCalledTimes(2);
  expect(textures.get('huge.png', 1, undefined, 'rgb(3,2,1)')!.image).toBe(a);
  expect(canvases).toHaveLength(1);
  textures.dispose(); expect(canvases[0].width).toBe(0);
});

it('keeps the 4K scene working set cached at physical display resolution without changing logical image size', async () => {
  const { canvases } = mockImages(3840, 2160);
  const blobs = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`layer${i}.png`, new Blob([String(i)])]));
  const textures = await ChartTextures.load(blobs);
  for (let frame = 0; frame < 3; frame++) for (let i = 0; i < 17; i++) {
    const image = textures.get(`layer${i}.png`, frame / 60, undefined, 'rgb(128,128,128)', true, .3)!;
    expect(image).toMatchObject({ width: 3840, height: 2160, filter: `brightness(${128 / 255})` });
    expect((image.image as HTMLCanvasElement).width).toBeGreaterThanOrEqual(3840 * .3);
  }
  expect(canvases).toHaveLength(17);
  expect(canvases.every(c => c.width > 0)).toBe(true); // No working-set eviction loop.
  textures.dispose();
});

it('selects a sharper cache level after zooming or increasing export resolution', async () => {
  const { bitmap } = mockImages(3840, 2160);
  const textures = await ChartTextures.load({ 'image.png': new Blob(['png']) });
  const small = textures.get('image.png', 0, undefined, undefined, false, .3)!;
  const larger = textures.get('image.png', 0, undefined, undefined, false, .6)!;
  expect((small.image as HTMLCanvasElement).width).toBeLessThan((larger.image as HTMLCanvasElement).width);
  expect(textures.get('image.png', 0, undefined, undefined, false, 1)!.image).toBe(bitmap);
  for (const scale of [.001, .1, .3, .6, .99]) {
    expect(textureResolution(scale)).toBeGreaterThanOrEqual(scale);
    expect(textureResolution(scale)).toBeLessThanOrEqual(1);
  }
  textures.dispose();
});

it('releases immutable display cache bitmaps on eviction and chart disposal', async () => {
  const { canvases } = mockImages(4096, 4096), snapshots: { close: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(_width: number, _height: number) {}
    getContext() { return { drawImage: vi.fn() }; }
    transferToImageBitmap() { const image = { close: vi.fn() }; snapshots.push(image); return image; }
  });
  const textures = await ChartTextures.load({ 'big.png': new Blob(['png']) });
  textures.get('big.png',0,undefined,'rgb(1,2,3)');
  textures.get('big.png',0,undefined,'rgb(2,3,4)');
  textures.get('big.png',0,undefined,'rgb(3,4,5)');
  expect(snapshots[0].close).toHaveBeenCalledTimes(1);
  expect(canvases.every(canvas=>canvas.width===0&&canvas.height===0)).toBe(true);
  textures.dispose();
  expect(snapshots.every(image=>image.close.mock.calls.length===1)).toBe(true);
});

it('keys GIF tint variants by decoded frame and reuses the right result after a backward seek', async () => {
  const { canvases } = mockImages(16, 16);
  const source = [0, 1].map(() => ({ displayWidth: 16, displayHeight: 16, duration: 100000, close: vi.fn() }));
  vi.stubGlobal('ImageDecoder', class {
    static async isTypeSupported() { return true; }
    tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 2 } };
    completed = Promise.resolve();
    async decode({ frameIndex }: { frameIndex: number }) { return { image: source[frameIndex] }; }
    close() {}
  });
  const textures = await ChartTextures.load({ 'anim.gif': new Blob(['GIF89a']) });
  const first = textures.get('anim.gif', .05, undefined, 'rgb(120,180,220)')!.image;
  const second = textures.get('anim.gif', .15, undefined, 'rgb(120,180,220)')!.image;
  expect(first).not.toBe(second);
  expect(textures.get('anim.gif', .05, undefined, 'rgb(120,180,220)')!.image).toBe(first);
  expect(canvases).toHaveLength(2);
  textures.dispose(); expect(source.every(frame => frame.close.mock.calls.length === 1)).toBe(true);
});

it('culls only fully offscreen image bounds, including anchors, rotation and mirrored scales', () => {
  const visible = (x: number, y: number, width = 40, height = 40, sx = 1, sy = 1, rotation = 0, anchor = [.5, .5]) =>
    textureIsVisible(x, y, width, height, sx, sy, rotation, anchor, 0, 100, 100);
  expect(visible(110, 50)).toBe(true); expect(visible(121, 50)).toBe(false);
  expect(visible(120, 50, 40, 40, -1, 1, 0, [0, .5])).toBe(true);
  expect(visible(50, 150, 100, 10, 1, 1, 90)).toBe(true);
  expect(visible(50, 151, 100, 10, 1, 1, 90)).toBe(false);
  expect(visible(50, 50, 40, 40, 0)).toBe(false);
  expect(textureIsVisible(20, 50, 20, 20, 1, 1, 0, [.5, .5], 40, 100, 100)).toBe(false);
});
