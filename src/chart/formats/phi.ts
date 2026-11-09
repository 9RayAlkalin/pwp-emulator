import { rpeEase } from '../animation/easing';

// Native enum labels are misleading: types 1..3 are quadratic, not sine.
// See phira-docs/chart-standard/chart-format/phi/blockArea.md.
export const phigrosEaseToRpe = [1, 5, 4, 7, 9, 8, 12, 11, 10, 13, 15, 14] as const;
function curve(progress: number, type: number): number {
  if (type === 13) return 0;
  if (type === 14) return 1;
  // RPE has In/OutQuint but no InOutQuint index; compose its two halves.
  if (type === 12) return progress < .5 ? rpeEase(progress * 2, 15) / 2 : .5 + rpeEase(progress * 2 - 1, 14) / 2;
  return rpeEase(progress, phigrosEaseToRpe[type] ?? 1);
}

// Preserve native 1% Float32 sampling and interpolation, rather than silently
// replacing BlockArea/PostFX timing with direct analytical evaluation.
const tables = Array.from({ length: 15 }, (_, type) => Float32Array.from({ length: 101 }, (_, i) => curve(i / 100, type)));
export function phigrosEase(progress: number, type: number): number {
  const row = tables[type] || tables[0];
  if (progress <= 0) return row[0];
  if (progress >= 1) return row[100];
  const scaled = progress * 100, index = Math.floor(scaled);
  return row[index] + (scaled - index) * (row[index + 1] - row[index]);
}
