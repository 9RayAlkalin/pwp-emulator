import type { ChartNote, LineAnimation } from '../types';
import { controlValue } from '../animation/state';
import { get_event_val } from '../animation/timeline';

// Geometry uses authored RPE units. The controller coordinate is the signed
// unscaled floor distance plus yOffset, before note.speed or YControl.
// Projection conventions were checked against the user's RPEN video; source
// revision and adopted/rejected behaviour are in research/notes/chart-adapters.md.
export function chartNoteGeometry(note: Pick<ChartNote, 'positionX' | 'speed' | 'type'>,
                                  animation: LineAnimation | undefined, time: number, distance: number, above = true) {
  const hold = note.type === 3, controls = animation?.controls;
  const position = note.positionX * 75.9375;
  const size = hold ? 1 : controlValue(controls?.size, distance);
  const y = hold ? 1 : controlValue(controls?.y, distance);
  const x = hold ? 1 : controlValue(controls?.x, distance);
  const incline = hold || !animation?.incline?.length ? 0 :
    get_event_val(time, animation.incline, 'start', 'end');
  const skew = hold ? 0 : position * controlValue(controls?.skew, distance, 0);
  const perspective = Math.tan(position / 675 * incline * Math.PI / 180) * distance * note.speed * (above ? 1 : -1);
  return { x: position * x - perspective, y: distance * note.speed * y, size,
    alpha: controlValue(controls?.alpha, distance), skew };
}

export function chartHoldSpan(startFloor: number, tailFloor: number, nowFloor: number, active: boolean): [number, number] {
  // Before the head use two independently integrated endpoints. Afterwards
  // pin the head to the line; the tail still follows the signed speed integral.
  return [active ? 0 : startFloor - nowFloor, tailFloor - nowFloor];
}
