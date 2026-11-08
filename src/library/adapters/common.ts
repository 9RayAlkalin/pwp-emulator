import type { ChartEasing, ChartEvent, ChartLine } from '../../types';
import { easingProgress } from '../../core/chart-easing';
import { eventValue, find_event } from '../../core/timeline';

export const TRACK_START = -1e6;
export const TRACK_END = 1e9;
// A tick is a second at this BPM, so the existing runtime needs no tempo map.
export const SECOND_BPM = 60 / 32;
export interface BeatEvent { startTime: number; endTime: number; start?: number; end: number; easing?: ChartEasing; }
export function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须为对象`);
  return value as Record<string, any>;
}
export function finite(value: unknown, label: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} 必须为有限数值`);
  return value;
}
export function beat(value: unknown): number {
  if (!Array.isArray(value) || value.length !== 3 || value.some(v => !Number.isInteger(v)) || value[2] <= 0) throw new Error('RPE beat 必须为有效的 [整数, 分子, 正分母]');
  return value[0] + value[1] / value[2];
}
export function array(value: unknown, label: string): any[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} 必须为数组`);
  return value;
}

export class TempoMap {
  readonly changes: { beat: number; bpm: number; time: number }[];
  constructor(input: { beat: number; bpm: number }[]) {
    if (!input.length) throw new Error('谱面缺少 BPM 列表');
    const sorted = input.map(e => {
      finite(e.beat, 'BPM 时间');
      if (finite(e.bpm, 'BPM') <= 0) throw new Error('BPM 必须大于零');
      return e;
    }).sort((a, b) => a.beat - b.beat);
    const unique = new Map(sorted.map(e => [e.beat, e]));
    this.changes = [...unique.values()].map(e => ({ ...e, time: 0 }));
    for (let i = 1; i < this.changes.length; i++) {
      const prev = this.changes[i - 1], next = this.changes[i];
      next.time = prev.time + (next.beat - prev.beat) * 60 / prev.bpm;
    }
    const origin = this.seconds(0);
    for (const e of this.changes) e.time -= origin;
  }
  seconds(beat: number, factor = 1): number {
    let lo = 0, hi = this.changes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.changes[mid].beat <= beat) lo = mid; else hi = mid - 1;
    }
    const e = this.changes[lo];
    return (e.time + (beat - e.beat) * 60 / e.bpm) * factor;
  }
  bpmAt(beat: number, factor = 1): number {
    let bpm = this.changes[0].bpm;
    for (const e of this.changes) { if (e.beat > beat) break; bpm = e.bpm; }
    return bpm / factor;
  }
}

function beatValue(e: BeatEvent, t: number): number {
  if (e.endTime === e.startTime) return e.end;
  const p = Math.max(0, Math.min(1, (t - e.startTime) / (e.endTime - e.startTime)));
  return e.start! + (e.end - e.start!) * easingProgress(p, e.easing ?? { type: 1 });
}

// Fill gaps and pre-empt overlapping events before splitting at BPM changes.
// Keep progress through the original curve, rather than restarting easing at a BPM boundary.
export function compileTrack(input: BeatEvent[], tempo: TempoMap, fallback = 0, factor = 1, scale = 1, offset = 0): ChartEvent[] {
  const events = input.map(e => ({ ...e })).sort((a, b) => a.startTime - b.startTime);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.endTime < e.startTime) throw new Error('事件结束时间不能早于开始时间');
    e.start ??= i ? beatValue(events[i - 1], e.startTime) : fallback;
  }
  const result: ChartEvent[] = [];
  let cursor = Math.min(TRACK_START, tempo.seconds(events[0]?.startTime ?? 0, factor) - 1), held = fallback;
  const constant = (end: number) => {
    if (end > cursor) result.push({ startTime: cursor, endTime: end, start: held * scale + offset, end: held * scale + offset });
    cursor = end;
  };
  for (let i = 0; i < events.length; i++) {
    const e = events[i], finish = Math.min(e.endTime, events[i + 1]?.startTime ?? e.endTime);
    const start = tempo.seconds(e.startTime, factor);
    constant(start);
    if (finish <= e.startTime) { held = e.endTime === e.startTime ? e.end : e.start!; continue; }
    const boundaries = [e.startTime, ...tempo.changes.filter(c => c.beat > e.startTime && c.beat < finish).map(c => c.beat), finish];
    for (let j = 1; j < boundaries.length; j++) {
      const from = boundaries[j - 1], to = boundaries[j];
      result.push({ startTime: tempo.seconds(from, factor), endTime: tempo.seconds(to, factor),
        start: e.start! * scale + offset, end: e.end * scale + offset,
        easing: { ...e.easing, type: e.easing?.type ?? 1, from: (from - e.startTime) / (e.endTime - e.startTime), to: (to - e.startTime) / (e.endTime - e.startTime) } });
    }
    cursor = tempo.seconds(finish, factor); held = beatValue(e, finish);
  }
  constant(Math.max(TRACK_END, cursor + 1));
  return result;
}

export function combineSpeeds(layers: ChartEvent[][]): ChartEvent[] {
  const points = [...new Set(layers.flatMap(events => events.flatMap(e => [e.startTime, e.endTime])))].sort((a, b) => a - b);
  const result: ChartEvent[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const active = layers.map(events => events[find_event((a + b) / 2, events)]).filter(Boolean);
    const curved = active.some(e => e.start !== e.end && e.easing && (e.easing.type !== 1 || e.easing.bezier));
    // Linear speed ramps integrate exactly. Nonlinear ramps use bounded 240 Hz trapezoids.
    const steps = curved ? Math.max(1, Math.min(65536, Math.ceil((b - a) * 240))) : 1;
    for (let j = 0; j < steps; j++) {
      const startTime = a + (b - a) * j / steps, endTime = a + (b - a) * (j + 1) / steps;
      const value = active.reduce((s, e) => s + eventValue(startTime, e), 0);
      const endValue = active.reduce((s, e) => s + eventValue(endTime, e), 0);
      result.push({ startTime, endTime, value, endValue });
    }
  }
  // Anchor the integrated floor at chart time zero, including negative-time events.
  let floor = 0, origin = 0;
  for (const e of result) {
    if (e.startTime <= 0 && e.endTime > 0) {
      const dt = -e.startTime;
      origin = floor + dt * e.value! + (e.endValue! - e.value!) / (e.endTime - e.startTime) * dt * dt / 2;
    }
    floor += (e.endTime - e.startTime) * (e.value! + e.endValue!) / 2;
  }
  if (result.length) result[0].floorOrigin = origin;
  return result;
}

export function emptyLine(): ChartLine {
  return { bpm: SECOND_BPM, notesAbove: [], notesBelow: [], speedEvents: [],
    judgeLineMoveEvents: [], judgeLineRotateEvents: [], judgeLineDisappearEvents: [] };
}
