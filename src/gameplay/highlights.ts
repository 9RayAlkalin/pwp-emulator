import type { ChartData } from '../chart/types';
import type { RuntimeNote } from './types';

export function noteHighlights(notes: readonly Pick<RuntimeNote, 'sect' | 'isFake' | 'highlight'>[], format: ChartData['sourceFormat']): boolean[] {
  const rpe = format === 'rpe';
  const key = (time: number) => rpe ? Math.round(time * 1e6) : time;
  const counts = new Map<number, number>();
  for (const note of notes) {
    if (rpe ? note.highlight === 0 : note.isFake) continue;
    const time = key(note.sect); counts.set(time, (counts.get(time) ?? 0) + 1);
  }
  return notes.map(note => rpe ? note.highlight === 0 ? false : note.highlight === 2 || (counts.get(key(note.sect)) ?? 0) > 1
    : !note.isFake && (counts.get(key(note.sect)) ?? 0) > 1);
}
