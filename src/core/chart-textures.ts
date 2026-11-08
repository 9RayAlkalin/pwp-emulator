export interface TextureFrame { image: CanvasImageSource; end: number; }
export interface DecodedTexture {
  width: number;
  height: number;
  frames: TextureFrame[];
  duration: number;
  dispose(): void;
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
  private readonly tint = document.createElement('canvas');

  static async load(blobs: Record<string, Blob> = {}): Promise<ChartTextures> {
    const result = new ChartTextures();
    try {
      for (const [name, blob] of Object.entries(blobs)) {
        try { result.textures.set(name, await decodeTexture(blob)); }
        catch (error) { throw new Error(`判定线纹理 ${name}：${error instanceof Error ? error.message : error}`); }
      }
      return result;
    } catch (error) { result.dispose(); throw error; }
  }

  get(name: string, time: number, progress?: number, color?: string) {
    const texture = this.textures.get(name);
    if (!texture) return undefined;
    let image = texture.frames[textureFrame(texture, time, progress)].image;
    if (color && color !== 'rgb(255,255,255)') {
      const canvas = this.tint;
      canvas.width = texture.width; canvas.height = texture.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = color; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(image, 0, 0);
      image = canvas;
    }
    return { image, width: texture.width, height: texture.height };
  }

  dispose(): void {
    this.textures.forEach(texture => texture.dispose()); this.textures.clear();
    this.tint.width = this.tint.height = 0;
  }
}
