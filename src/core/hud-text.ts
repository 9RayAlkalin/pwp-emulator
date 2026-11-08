interface GlyphMetrics { advance: number; w?: number; }
export interface HudFontMetrics { ascent: number; sizes: Record<string, Record<string, GlyphMetrics>>; }
interface Raster { image: HTMLCanvasElement; left: number; top: number; }

// Rasterize above the final pixel size before downsampling. This keeps small-size
// browser hinting from making the Regular face heavier than the original glyphs.
export class HudTextRenderer {
  private readonly cache = new Map<string, Raster>();
  private readonly scratch = document.createElement('canvas');
  draw(ctx: CanvasRenderingContext2D, value: unknown, size: number, align: CanvasTextAlign,
       x: number, y: number, maxWidth: number, metrics?: HudFontMetrics): void {
    const text = String(value);
    const chars = Array.from(text);
    const table = metrics?.sizes[size];
    const transform = ctx.getTransform();
    const density = transform.a;
    if (!(density > 0) || transform.b || transform.c || transform.d !== density) return;
    const known = table && chars.every(char => table[char]);
    const measure = this.scratch.getContext('2d')!;
    measure.font = `400 ${size}px PhiHUD, sans-serif`;
    const width = known ? chars.reduce((sum, char) => sum + table[char].advance, 0) : measure.measureText(text).width;
    const fit = width > maxWidth ? maxWidth / width : 1;
    const pixelSize = size * fit * density;
    const baseline = Math.round((y + ((metrics?.ascent ?? 0.88) - 0.5) * size * fit) * density + transform.f);
    let pen = x - width * fit * (align === 'right' || align === 'end' ? 1 : align === 'center' ? 0.5 : 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (known) {
      for (const char of chars) {
        if (table[char].w) {
          const glyph = this.raster(char, pixelSize);
          ctx.drawImage(glyph.image, Math.round(pen * density + transform.e) + glyph.left, baseline + glyph.top);
        }
        pen += table[char].advance * fit;
      }
    } else {
      // Shape unfamiliar scripts as a whole line, preserving joining and kerning.
      const line = this.raster(text, pixelSize);
      ctx.drawImage(line.image, Math.round(pen * density + transform.e) + line.left, baseline + line.top);
    }
    ctx.restore();
  }
  private raster(text: string, pixelSize: number): Raster {
    const key = `${pixelSize}:${text}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const factor = 4;
    const scratch = this.scratch;
    let context = scratch.getContext('2d')!;
    context.font = `400 ${pixelSize}px PhiHUD, sans-serif`;
    const bounds = context.measureText(text);
    const left = Math.floor(-bounds.actualBoundingBoxLeft) - 2;
    const top = Math.floor(-bounds.actualBoundingBoxAscent) - 2;
    const width = Math.max(1, Math.ceil(bounds.actualBoundingBoxRight) - left + 2);
    const height = Math.max(1, Math.ceil(bounds.actualBoundingBoxDescent) - top + 2);
    scratch.width = width * factor;
    scratch.height = height * factor;
    context = scratch.getContext('2d')!;
    context.scale(factor, factor);
    context.font = `400 ${pixelSize}px PhiHUD, sans-serif`;
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#fff';
    context.fillText(text, -left, -top);
    const image = document.createElement('canvas');
    image.width = width; image.height = height;
    const output = image.getContext('2d')!;
    output.imageSmoothingQuality = 'high';
    output.drawImage(scratch, 0, 0, width, height);
    const raster = { image, left, top };
    if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, raster);
    return raster;
  }
}
