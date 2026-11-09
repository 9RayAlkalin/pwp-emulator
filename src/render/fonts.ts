let nextFont = 0;
export class ChartFonts {
  private readonly fonts = new Map<string, FontFace>();
  static async load(blobs: Record<string, Blob> = {}): Promise<ChartFonts> {
    const result = new ChartFonts();
    try {
      for (const [name, blob] of Object.entries(blobs)) {
        const face = new FontFace(`PwpChart${nextFont++}`, await blob.arrayBuffer());
        result.fonts.set(name, face); await face.load(); document.fonts.add(face);
      }
      return result;
    } catch (error) { result.dispose(); throw error; }
  }
  family(name?: string): string { return name && this.fonts.get(name)?.family || 'PhiHUD, sans-serif'; }
  dispose(): void { this.fonts.forEach(face => document.fonts.delete(face)); this.fonts.clear(); }
}
