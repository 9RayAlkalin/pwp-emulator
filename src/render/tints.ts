import type { ChartColor } from '../chart/types';

export class SpriteTints {
  private readonly ids = new WeakMap<object, number>();
  private readonly cache = new Map<string, HTMLCanvasElement>();
  private nextId = 0;
  private pixels = 0;
  get(image: CanvasImageSource, color?: ChartColor | string): CanvasImageSource {
    if (!color || Array.isArray(color) && color.every(v => v === 255) || color === 'rgb(255,255,255)') return image;
    let id = this.ids.get(image); if (id === undefined) { id = this.nextId++; this.ids.set(image, id); }
    const rgb = Array.isArray(color) ? `rgb(${color.join(',')})` : color, key = `${id}:${rgb}`;
    const existing = this.cache.get(key);
    if (existing) { this.cache.delete(key); this.cache.set(key, existing); return existing; }
    const source = image as HTMLImageElement;
    const width = source.naturalWidth || source.width, height = source.naturalHeight || source.height;
    const pixels = width * height;
    while (this.cache.size && (this.pixels + pixels > 8 * 1024 * 1024 || this.cache.size >= 128)) {
      const [oldKey, canvas] = this.cache.entries().next().value!;
      this.cache.delete(oldKey); this.pixels -= canvas.width * canvas.height; canvas.width = canvas.height = 0;
    }
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = rgb; ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(image, 0, 0);
    this.cache.set(key, canvas); this.pixels += pixels; return canvas;
  }
  clear(): void { this.cache.forEach(canvas => { canvas.width = canvas.height = 0; }); this.cache.clear(); this.pixels = 0; }
}
