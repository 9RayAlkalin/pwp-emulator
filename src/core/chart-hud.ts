import type { ChartLine, HudElement } from '../types';
import { lineAppearance, type LineState } from './chart-state';
import { defaultChartAspect, type ChartViewport } from './chart-viewport';

export function gameHudLayout(w: number, h: number, bounds?: Pick<ChartViewport, 'left' | 'width'>) {
  // Keep screen-height sizing. Chart bounds move only the side anchors;
  // a narrower chart must never scale down HUD text or controls.
  const scale = h / 1000;
  const width = w / scale, height = h / scale;
  const half_width = bounds ? bounds.width / scale / 2 : w / h >= defaultChartAspect ? 888.888916015625 : width / 2;
  const left = bounds ? bounds.left / scale : width / 2 - half_width;
  const right = bounds ? (bounds.left + bounds.width) / scale : width / 2 + half_width;
  return { scale, width, height, half_width, left, right,
    pause: { x: left + 50.589 - 34.262 / 2, y: 55.7 - 37.966 / 2, width: 34.262, height: 37.966 },
    score: { x: right - 37.39, y: 54.3 },
    combo: { x: width / 2, y: 48 },
    combo_text: { x: width / 2, y: 95 },
    song: { x: left + 40, y: height - 49.8 },
    level: { x: right - 40, y: height - 49.8 },
    cover: { left: bounds ? left : width / 2 - 888.8889, right: bounds ? right : width / 2 + 888.8889, width: 1000 },
    progress: { left, span: 2 * half_width, width: 1919, height: 11 } };
}

export interface HudAttachment { dx: number; dy: number; rotation: number; scaleX: number; scaleY: number; alpha: number; color?: string; }
export function hudPointCovered(x: number, y: number, layout: { height: number; cover: { left: number; right: number; width: number } }): boolean {
  const { left, right, width } = layout.cover;
  return left > 0 && y >= 0 && y < layout.height &&
    (x >= left - width && x < left || x >= right && x < right + width);
}
export function hudAttachment(lines: ChartLine[], element: HudElement, time: number,
                              state: (line: ChartLine, time: number) => LineState, width: number, height: number): HudAttachment | undefined {
  let line: ChartLine | undefined;
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].animation?.attachUI === element) { line = lines[i]; break; }
  if (!line) return undefined;
  const [rotation, x, y, alpha] = state(line, time), appearance = lineAppearance(line, time);
  return { dx: (x - .5) * width, dy: (y - .5) * height, rotation,
    scaleX: appearance.scaleX, scaleY: appearance.scaleY, alpha: Math.max(0, Math.min(1, alpha)), color: appearance.color };
}
export function applyHudAttachment(ctx: CanvasRenderingContext2D, a: HudAttachment | undefined, x: number, y: number): void {
  if (!a) return;
  ctx.globalAlpha *= a.alpha;
  ctx.translate(a.dx + x, a.dy + y); ctx.rotate(a.rotation * Math.PI / 180);
  ctx.scale(a.scaleX, a.scaleY); ctx.translate(-x, -y);
}
export function inverseHudPoint(x: number, y: number, a: HudAttachment | undefined, px: number, py: number): [number, number] | undefined {
  if (!a) return [x, y];
  if (a.alpha <= 0 || Math.abs(a.scaleX) < 1e-9 || Math.abs(a.scaleY) < 1e-9) return undefined;
  const rad = a.rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = x - a.dx - px, dy = y - a.dy - py;
  return [(dx * cos + dy * sin) / a.scaleX + px, (-dx * sin + dy * cos) / a.scaleY + py];
}
