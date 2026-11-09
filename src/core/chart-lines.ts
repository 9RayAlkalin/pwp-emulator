import type { ChartLine } from '../types';

// RPE's standard line.png uses RPE coordinate pixels, not the Phigros Unity
// Sprite's 19.2 world-unit width and child transform. Keep both paths separate.
export const rpeLinePixels = { width: 4000, height: 5 } as const;
export function rpeLineSize(textureScale: number, scaleX = 1, scaleY = 1): { halfLength: number; width: number } {
  return { halfLength: rpeLinePixels.width / 2 * textureScale * scaleX,
    width: Math.abs(rpeLinePixels.height * textureScale * scaleY) };
}
export function lineVisualKind(line: ChartLine): 'text' | 'texture' | 'line' {
  if (line.animation?.text?.length) return 'text';
  return line.animation?.texture ? 'texture' : 'line';
}
export function orderedLines(lines: readonly ChartLine[]): ChartLine[] {
  return lines.filter(line => !line.animation?.attachUI)
    .sort((a, b) => (a.animation?.zOrder ?? 0) - (b.animation?.zOrder ?? 0));
}
