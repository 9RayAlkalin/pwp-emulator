import type { ChartEasing, ChartEvent } from '../types';
import { easingProgress, rpeEase } from './easing';

// Antiderivatives of the authored RPE curves. Unsupported curves retain the
// compiler's bounded trapezoid fallback (not a per-frame numerical integral).
function primitive(x: number, type: number): number | undefined {
  const power = (n: number, out = false) => out ? x + (1 - x) ** (n + 1) / (n + 1) : x ** (n + 1) / (n + 1);
  switch (type) {
    case 1: return x * x / 2;
    case 2: return -2 / Math.PI * Math.cos(x * Math.PI / 2);
    case 3: return x - 2 / Math.PI * Math.sin(x * Math.PI / 2);
    case 4: return power(2, true);
    case 5: return power(2);
    case 6: return x / 2 - Math.sin(Math.PI * x) / (2 * Math.PI);
    case 7: return x < .5 ? 2 * x ** 3 / 3 : x + (2 - 2 * x) ** 3 / 12 - .5;
    case 8: return power(3, true);
    case 9: return power(3);
    case 10: return power(4, true);
    case 11: return power(4);
    case 12: return x < .5 ? x ** 4 : x + (2 - 2 * x) ** 4 / 16 - .5;
    case 13: return x < .5 ? 8 * x ** 5 / 5 : x + (2 - 2 * x) ** 5 / 20 - .5;
    case 14: return power(5, true);
    case 15: return power(5);
    case 16: return x + 2 ** (-10 * x) / (10 * Math.LN2);
    case 17: return 2 ** (10 * x - 10) / (10 * Math.LN2);
    case 18: { const u = x - 1; return (u * Math.sqrt(Math.max(0, 1 - u * u)) + Math.asin(u)) / 2; }
    case 19: return x - (x * Math.sqrt(Math.max(0, 1 - x * x)) + Math.asin(x)) / 2;
    case 20: return x + 2.70158 * (x - 1) ** 4 / 4 + 1.70158 * (x - 1) ** 3 / 3;
    case 21: return 2.70158 * x ** 4 / 4 - 1.70158 * x ** 3 / 3;
    default: return undefined;
  }
}

export function hasExactIntegral(easing?: ChartEasing): boolean {
  return !easing || !easing.bezier && primitive(.5, easing.type) !== undefined;
}

function area(a: number, b: number, easing: ChartEasing): number {
  const left = Math.max(0, Math.min(1, easing.left ?? 0)), right = Math.max(0, Math.min(1, easing.right ?? 1));
  // Match easingProgress's degenerate-range behaviour.
  const l = left === right ? 0 : left, r = left === right ? 1 : right;
  const evaluate = (x: number) => rpeEase(x, easing.type);
  const base = left === right ? 0 : evaluate(l), range = left === right ? 1 : evaluate(r) - base;
  if (Math.abs(range) < 1e-12) return (b * b - a * a) / 2;
  return ((primitive(l + (r - l) * b, easing.type)! - primitive(l + (r - l) * a, easing.type)!) / (r - l) - base * (b - a)) / range;
}

export function eventIntegral(event: ChartEvent, start: number, end: number): number {
  const duration = event.endTime - event.startTime;
  const a = Number(event.start ?? 0), b = Number(event.end ?? 0);
  if (!duration || a === b) return (end - start) * a;
  const from = (start - event.startTime) / duration, to = (end - event.startTime) / duration;
  const easing = event.easing ?? { type: 1 };
  const origin = easing.from ?? 0, span = (easing.to ?? 1) - origin;
  const integral = span === 0 ? (to - from) * easingProgress(0, easing)
    : area(origin + from * span, origin + to * span, easing) / span;
  return duration * (a * (to - from) + (b - a) * integral);
}
