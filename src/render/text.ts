// Cache layout only, leaving glyph rasterization at the final Canvas transform
// so rotated/scaled text retains the existing browser font quality.
export class LineTextLayout {
  private readonly entries = new Map<string, { rows: string[]; width: number }>();
  get(context: CanvasRenderingContext2D, text: string): { rows: string[]; width: number } {
    const key = `${context.font}\0${text}`;
    const cached = this.entries.get(key);
    if (cached) return cached;
    const rows = text.split('\n');
    let width = 0;
    for (const row of rows) width = Math.max(width, context.measureText(row).width);
    if (this.entries.size >= 256) this.entries.delete(this.entries.keys().next().value!);
    const layout = { rows, width };
    this.entries.set(key, layout);
    return layout;
  }
  clear(): void { this.entries.clear(); }
}
