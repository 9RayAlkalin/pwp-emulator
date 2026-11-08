import type { Grade, RuntimeNote, Statistics } from '../types';

// Phigros 4.0.1.2 ARM64 evidence: workspace research/notes/gameplay-audit.md.
export const gameplayMetrics = {
  lineHalfLength: 2.88, // Sprite 19.2 world units * child scale 3 / viewport 10 / 2.
  lineWidth: 0.0075,
  badDuration: 0.41666666,
  holdMissAlpha: 0.45,
};
export function noteViewportScale(width: number, height: number): number {
  // LevelControl.Start @1D7BE80..9C and JudgeLine.CreateNote @1D77F1C..70.
  return Math.min(1, width / height / 1.7778);
}
export function judgeLineColor(indicator: boolean, stats: Pick<Statistics, 'good' | 'bad' | 'miss'>): string {
  if (!indicator || stats.bad || stats.miss) return '#ffffff';
  return stats.good ? '#b3ecff' : '#ffffb4';
}
export function lateNoteAlpha(note: RuntimeNote, time: number): number {
  const late = Math.max(0, time - note.sect);
  // Click.NoteMove: GoodTimeRange-.02; Drag/Flick.NoteMove: .1 seconds.
  return Math.max(0, Math.min(1, 1 - late / (note.type === 1 ? 0.16 : 0.1)));
}
export function badNoteAlpha(elapsed: number): number {
  if (elapsed < 0 || elapsed >= gameplayMetrics.badDuration) return 0;
  const duration = gameplayMetrics.badDuration, u = elapsed / duration, u2 = u * u, u3 = u2 * u;
  // CilckBad.anim, unweighted Hermite alpha keys: (0,1,m=0), (25/60,0,m=-6.6625743).
  return Math.max(0, Math.min(1, 2 * u3 - 3 * u2 + 1 + (u3 - u2) * duration * -6.6625743));
}
export function noteIsVisible(note: RuntimeNote, result: { grade: Grade; holding?: boolean } | undefined,
                              time: number, autoplay: boolean): boolean {
  if (note.is_hold) return time <= note.hold_end_time + 0.25;
  if (!autoplay && result) return false;
  return autoplay ? time <= note.sect : time <= note.sect + (note.type === 1 ? 0.18 : note.type === 2 ? 0.1 : 0.14);
}

// Runtime renderers use Default/-1. Hold.NoteMove writes local z=.0001,
// ordinary notes z=0: Hold is farther from the camera and is drawn first.
// Equal-depth ordinary notes retain the manager registration order; Unity's
// exact tie break still needs a native overlap capture.
export function orderedNotes(notes: readonly RuntimeNote[]): RuntimeNote[] {
  const order = { 3: 0, 1: 1, 2: 2, 4: 3 };
  return [...notes].sort((a, b) => order[a.type] - order[b.type] || a.sect - b.sect || (a.effectId ?? 0) - (b.effectId ?? 0));
}
