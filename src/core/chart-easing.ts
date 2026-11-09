import type { ChartEasing } from '../types';

const clamp = (t: number) => Math.max(0, Math.min(1, t));
function bounce(t: number): number {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + .75;
  if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + .9375;
  return 7.5625 * (t -= 2.625 / 2.75) * t + .984375;
}

// PEC/RPE numbering is independent of the game's block easing table.
export function chartEase(t: number, type = 1): number {
  t = clamp(t);
  if (t === 0 || t === 1) return t;
  switch (type) {
    case 2: return Math.sin(t * Math.PI / 2);
    case 3: return 1 - Math.cos(t * Math.PI / 2);
    case 4: return 1 - (1 - t) ** 2;
    case 5: return t ** 2;
    case 6: return (1 - Math.cos(Math.PI * t)) / 2;
    case 7: return t < .5 ? 2 * t ** 2 : 1 - (-2 * t + 2) ** 2 / 2;
    case 8: return 1 - (1 - t) ** 3;
    case 9: return t ** 3;
    case 10: return 1 - (1 - t) ** 4;
    case 11: return t ** 4;
    case 12: return t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    case 13: return t < .5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2;
    case 14: return 1 - (1 - t) ** 5;
    case 15: return t ** 5;
    case 16: return 1 - 2 ** (-10 * t);
    case 17: return 2 ** (10 * t - 10);
    case 18: return Math.sqrt(1 - (t - 1) ** 2);
    case 19: return 1 - Math.sqrt(1 - t ** 2);
    case 20: return 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
    case 21: return 2.70158 * t ** 3 - 1.70158 * t ** 2;
    case 22: return t < .5 ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2 : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2;
    case 23: return t < .5 ? (2 * t) ** 2 * (3.5949095 * 2 * t - 2.5949095) / 2 : ((2 * t - 2) ** 2 * (3.5949095 * (2 * t - 2) + 2.5949095) + 2) / 2;
    case 24: return 2 ** (-10 * t) * Math.sin((t * 10 - .75) * (2 * Math.PI / 3)) + 1;
    case 25: return -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * (2 * Math.PI / 3));
    case 26: return bounce(t);
    case 27: return 1 - bounce(1 - t);
    case 28: return t < .5 ? (1 - bounce(1 - 2 * t)) / 2 : (1 + bounce(2 * t - 1)) / 2;
    case 29: return t < .5
      ? -(2 ** (20 * t - 10)) * Math.sin((20 * t - 11.125) * (2 * Math.PI / 4.5)) / 2
      : 2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * (2 * Math.PI / 4.5)) / 2 + 1;
    default: return t;
  }
}

function bezier(t: number, p: number[]): number {
  const axis = (u: number, a: number, b: number) => 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * b + u ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (axis(mid, p[0], p[2]) < t) lo = mid; else hi = mid;
  }
  return axis((lo + hi) / 2, p[1], p[3]);
}

export function easingProgress(t: number, easing: ChartEasing): number {
  const p = (easing.from ?? 0) + clamp(t) * ((easing.to ?? 1) - (easing.from ?? 0));
  if (easing.bezier) return bezier(p, easing.bezier);
  const left = clamp(easing.left ?? 0), right = clamp(easing.right ?? 1);
  if (left === right) return chartEase(p, easing.type);
  const a = chartEase(left, easing.type), b = chartEase(right, easing.type);
  return Math.abs(b - a) < 1e-12 ? p : (chartEase(left + (right - left) * p, easing.type) - a) / (b - a);
}
