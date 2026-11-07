import type { ChartEvent, ChartNote } from '../types';

export function linear(t: number, start: number, end: number, from: number, to: number): number {
  return end === start ? to : from + (t - start) / (end - start) * (to - from);
}
export function find_event(time: number, events: ChartEvent[]): number {
  let lo = 0, hi = events.length - 1, result = events.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].endTime > time) { result = mid; hi = mid - 1; }
    else lo = mid + 1;
  }
  return result;
}
export function init_speed_events(events: ChartEvent[]): void {
  let floor = 0;
  for (const event of events) {
    event.floorPosition = floor;
    floor += (event.endTime - event.startTime) * (event.value ?? 0);
  }
}
export function get_fp(time: number, events: ChartEvent[]): number {
  const index = find_event(time, events);
  if (index < 0) return 0;
  const event = events[index];
  return (event.floorPosition ?? 0) + (time - event.startTime) * (event.value ?? 0);
}
export function get_event_val(time: number, events: ChartEvent[], from: string, to: string): number {
  const index = find_event(time, events);
  if (index < 0) return 0;
  const event = events[index];
  return linear(time, event.startTime, event.endTime, Number(event[from] ?? 0), Number(event[to] ?? 0));
}
export function merge_notes(above: ChartNote[], below: ChartNote[]) {
  return [...above.map(note => Object.assign(note, { is_above: true })), ...below.map(note => Object.assign(note, { is_above: false }))];
}
export function init_note_fp(notes: ChartNote[], events: ChartEvent[]): void {
  for (const note of notes) note.floorPosition = get_fp(note.time, events);
}
export function rotate_point(x: number, y: number, radius: number, degrees: number): [number, number] {
  return [x + radius * Math.cos(degrees * Math.PI / 180), y + radius * Math.sin(degrees * Math.PI / 180)];
}
