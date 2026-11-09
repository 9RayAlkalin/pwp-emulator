import type { ChartNote, LineAnimation } from '../chart/types';

export type Grade = 'perfect' | 'good' | 'bad' | 'miss';
export interface RuntimeNote extends ChartNote {
  sect: number;
  secht: number;
  hold_end_time: number;
  is_hold: boolean;
  is_above: boolean;
  clicked: boolean;
  effectId?: number;
  master: { bpm?: number; animation?: LineAnimation; get_viewport?(): { width: number; gameplayScale: number }; get_state(time: number): number[] };
}
export interface Statistics {
  perfect: number;
  good: number;
  bad: number;
  miss: number;
  combo: number;
  maxCombo: number;
  score: number;
  accuracy: number;
  total: number;
}
