export interface TextureFrame { image: CanvasImageSource; end: number; }
export interface DecodedTexture {
  width: number;
  height: number;
  frames: TextureFrame[];
  duration: number;
  dispose(): void;
}

interface TintedFrame { canvas: HTMLCanvasElement; image: CanvasImageSource; pixels: number; }
const tintPixelBudget = 32 * 1024 * 1024; // 128 MiB RGBA; display-sized variants, not full 4K colour copies.
const tintEntryLimit = 128;

// Equal RGB multipliers can be applied by the Canvas draw operation itself.
// Do not allocate a full-resolution tinted copy for every large grey layer.
export function grayscaleFilter(color?: string): string | undefined {
  const match = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(color ?? '');
  if (!match || match[1] !== match[2] || match[2] !== match[3] || Number(match[1]) > 255) return undefined;
  return `brightness(${Number(match[1]) / 255})`;
}

export function textureResolution(scale: number): number {
  // Cache a few levels and round upward so no cached pixel is magnified.
  if (!Number.isFinite(scale) || scale <= 0 || scale >= 1) return 1;
  return Math.min(1, 2 ** (Math.ceil(Math.log2(scale) * 2) / 2));
}

// Test the transformed rectangle, not just its origin: anchors, rotation and
// negative scale can leave a visible part on screen when the centre is outside.
export function textureIsVisible(x: number, y: number, width: number, height: number,
                                 scaleX: number, scaleY: number, rotation: number,
                                 anchor: readonly number[], left: number, right: number, bottom: number): boolean {
  const halfX = width * scaleX / 2, halfY = height * scaleY / 2;
  if (halfX === 0 || halfY === 0) return false;
  const rad = rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = (1 - anchor[0] * 2) * halfX, dy = (anchor[1] * 2 - 1) * halfY;
  const cx = x + dx * cos - dy * sin, cy = y + dx * sin + dy * cos;
  const rx = Math.abs(halfX * cos) + Math.abs(halfY * sin), ry = Math.abs(halfX * sin) + Math.abs(halfY * cos);
  return cx + rx >= left && cx - rx <= right && cy + ry >= 0 && cy - ry <= bottom;
}

// GIF progress addresses frames (0 = first, 1 = last); ordinary playback
// respects frame durations. Both paths are pure functions of chart time.
export function textureFrame(texture: Pick<DecodedTexture, 'frames' | 'duration'>, time: number, progress?: number): number {
  if (progress !== undefined) {
    const p = progress >= 0 && progress <= 1 ? progress : ((progress % 1) + 1) % 1;
    return Math.min(texture.frames.length - 1, Math.floor(p * texture.frames.length));
  }
  const t = ((time % texture.duration) + texture.duration) % texture.duration;
  let lo = 0, hi = texture.frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (texture.frames[mid].end > t) hi = mid; else lo = mid + 1;
  }
  return lo;
}

interface ImageDecoderInstance {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  completed: Promise<void>;
  decode(options: { frameIndex: number; completeFramesOnly: boolean }): Promise<{ image: VideoFrame }>;
  close(): void;
}
interface ImageDecoderConstructor {
  new(options: { data: ArrayBuffer; type: string; preferAnimation: boolean }): ImageDecoderInstance;
  isTypeSupported(type: string): Promise<boolean>;
}

async function decodeTexture(blob: Blob): Promise<DecodedTexture> {
  const header = await blob.slice(0, 6).text();
  if (header !== 'GIF87a' && header !== 'GIF89a') {
    const image = await createImageBitmap(blob);
    return { width: image.width, height: image.height, frames: [{ image, end: 1 }], duration: 1, dispose: () => image.close() };
  }
  const Decoder = (globalThis as typeof globalThis & { ImageDecoder?: ImageDecoderConstructor }).ImageDecoder;
  if (!Decoder || !await Decoder.isTypeSupported('image/gif')) throw new Error('当前浏览器不支持 GIF 逐帧解码，请使用新版 Edge / Chrome');
  const decoder = new Decoder({ data: await blob.arrayBuffer(), type: 'image/gif', preferAnimation: true });
  const frames: TextureFrame[] = [];
  let width = 0, height = 0, duration = 0;
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
    for (let i = 0; i < count; i++) {
      // ImageDecoder returns a composited full frame, including GIF disposal,
      // sub-rectangles and transparency. Retain it for deterministic seeks/export.
      const { image } = await decoder.decode({ frameIndex: i, completeFramesOnly: true });
      width = image.displayWidth; height = image.displayHeight;
      duration += Math.max(.01, (image.duration ?? 100000) / 1e6);
      frames.push({ image, end: duration });
    }
    if (!frames.length) throw new Error('GIF 缺少图像帧');
    return { width, height, frames, duration, dispose: () => frames.forEach(frame => (frame.image as VideoFrame).close()) };
  } catch (error) {
    frames.forEach(frame => (frame.image as VideoFrame).close());
    throw error;
  } finally { decoder.close(); }
}

export class ChartTextures {
  private readonly textures = new Map<string, DecodedTexture>();
  private readonly tints = new Map<string, TintedFrame>();
  private readonly frameIds = new WeakMap<TextureFrame, number>();
  private nextFrameId = 0;
  private tintPixels = 0;
  private scratch?: HTMLCanvasElement;
  private scratchKey?: string;

  static async load(blobs: Record<string, Blob> = {}): Promise<ChartTextures> {
    const result = new ChartTextures();
    const decoded = new Map<Blob, DecodedTexture>();
    try {
      const unique = [...new Set(Object.values(blobs))];
      let next = 0;
      // Bound simultaneous GIF decoders and wait for every worker before cleanup
      // on failure; otherwise a late decode could leak its VideoFrames.
      const workers = Array.from({ length: Math.min(4, unique.length) }, async () => {
        while (next < unique.length) {
          const blob = unique[next++];
          try { decoded.set(blob, await decodeTexture(blob)); }
          catch (error) {
            const name = Object.keys(blobs).find(name => blobs[name] === blob);
            throw new Error(`判定线纹理 ${name}：${error instanceof Error ? error.message : error}`);
          }
        }
      });
      const results = await Promise.allSettled(workers);
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') {
        decoded.forEach(texture => texture.dispose());
        throw failed.reason;
      }
      for (const [name, blob] of Object.entries(blobs)) result.textures.set(name, decoded.get(blob)!);
      return result;
    } catch (error) { result.dispose(); throw error; }
  }

  dimensions(name: string): { width: number; height: number } | undefined {
    return this.textures.get(name);
  }

  get(name: string, time: number, progress?: number, color?: string, drawFilters = false, renderedScale = 1):
    { image: CanvasImageSource; width: number; height: number; filter?: string } | undefined {
    const texture = this.textures.get(name);
    if (!texture) return undefined;
    const frame = texture.frames[textureFrame(texture, time, progress)];
    let image = frame.image;
    const filter = drawFilters && color !== 'rgb(255,255,255)' ? grayscaleFilter(color) : undefined;
    if (filter) return { ...this.get(name, time, progress, undefined, false, renderedScale)!, filter };
    const resolution = texture.width * texture.height >= 2 * 1024 * 1024 ? textureResolution(renderedScale) : 1;
    const width = Math.max(1, Math.ceil(texture.width * resolution)), height = Math.max(1, Math.ceil(texture.height * resolution));
    const tinted = !!color && color !== 'rgb(255,255,255)';
    if (tinted || resolution < 1) {
      let id = this.frameIds.get(frame);
      if (id === undefined) { id = this.nextFrameId++; this.frameIds.set(frame, id); }
      const key = `${id}:${resolution}:${tinted ? color : 'white'}`;
      const cached = this.tints.get(key);
      if (cached) {
        this.tints.delete(key); this.tints.set(key, cached);
        return { image: cached.image, width: texture.width, height: texture.height };
      }
      if (this.scratch && this.scratchKey === key) return { image: this.scratch, width: texture.width, height: texture.height };
      const pixels = width * height, cacheable = pixels <= tintPixelBudget;
      // Release the least recently used variants before allocating another full
      // image. Dynamic colour ramps cannot grow the cache without a bound.
      if (cacheable) while (this.tintPixels + pixels > tintPixelBudget || this.tints.size >= tintEntryLimit) {
        const oldest = this.tints.entries().next().value!;
        this.tints.delete(oldest[0]); this.tintPixels -= oldest[1].pixels;
        if (oldest[1].image !== oldest[1].canvas) (oldest[1].image as ImageBitmap).close();
        oldest[1].canvas.width = oldest[1].canvas.height = 0;
      }
      const canvas = cacheable ? document.createElement('canvas') : this.scratch ??= document.createElement('canvas');
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.globalCompositeOperation = 'copy'; ctx.drawImage(image, 0, 0, width, height);
      if (tinted) {
        ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = color!; ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(image, 0, 0, width, height);
      }
      if (cacheable) {
        let snapshot: CanvasImageSource = canvas;
        if (typeof OffscreenCanvas !== 'undefined') {
          const immutable = new OffscreenCanvas(width, height);
          immutable.getContext('2d')!.drawImage(canvas, 0, 0);
          snapshot = immutable.transferToImageBitmap(); canvas.width = canvas.height = 0;
        }
        this.tints.set(key, { canvas, image: snapshot, pixels }); this.tintPixels += pixels; image = snapshot;
      }
      else this.scratchKey = key;
      if (!cacheable) image = canvas;
    }
    return { image, width: texture.width, height: texture.height };
  }

  dispose(): void {
    new Set(this.textures.values()).forEach(texture => texture.dispose()); this.textures.clear();
    this.tints.forEach(({ canvas, image }) => { if (image !== canvas) (image as ImageBitmap).close(); canvas.width = canvas.height = 0; });
    this.tints.clear(); this.tintPixels = 0;
    if (this.scratch) this.scratch.width = this.scratch.height = 0;
    this.scratchKey = undefined;
  }
}
