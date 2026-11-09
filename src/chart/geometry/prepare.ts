import type { ChartLine, ChartNote } from '../types';
import { createLineStateResolver } from '../animation/state';
import { get_fp } from '../animation/timeline';
import { chartNoteGeometry } from './notes';

export interface PreparedChart { sourceFormat?: string; lines: ChartLine[]; notes: { line: number; note: ChartNote; above: boolean }[]; }
export interface GeometryFrame { time: number; aspect: number; lines: Float64Array; notes: Float64Array; }

// Plain chart data only: no Canvas, DOM, judgement state or runtime callbacks.
export function createGeometryPreparer(chart: PreparedChart) {
  const state = createLineStateResolver(chart.lines, () => aspect);
  let aspect = 16 / 9;
  return (time: number, nextAspect: number, lines: Float64Array = new Float64Array(chart.lines.length * 5),
          notes: Float64Array = new Float64Array(chart.notes.length * 5)): GeometryFrame => {
    aspect = nextAspect;
    chart.lines.forEach((line, i) => {
      const offset = i * 5;
      lines.set(state(line, time), offset);
      lines[offset + 4] = get_fp(time * line.bpm / (60 / 32), line.speedEvents);
    });
    chart.notes.forEach(({ line: index, note, above }, i) => {
      const line = chart.lines[index];
      if (!line.animation) return;
      const headTime = note.time * (60 / 32) / line.bpm;
      const active = note.type === 3 && time > headTime && (!note.isFake || chart.sourceFormat === 'rpe');
      const distance = (active ? 0 : ((note.floorPosition ?? 0) - lines[index * 5 + 4]) * .6 * (60 / 32 / line.bpm) * 900) + (note.yOffset ?? 0) * 540;
      const geometry = chartNoteGeometry(note, line.animation, time, distance, above);
      notes.set([geometry.x, geometry.y, geometry.size, geometry.alpha, geometry.skew], i * 5);
    });
    return { time, aspect, lines, notes };
  };
}
