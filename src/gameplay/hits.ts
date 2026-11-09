import type { RuntimeNote } from './types';
import { get_fp } from '../chart/animation/timeline';
import { chartNoteGeometry } from '../chart/geometry/notes';

export type HitGrade = 'perfect' | 'good';
export interface HitEffect { note: RuntimeNote; time: number; grade: HitGrade; seed: number; elapsed?: number; }
export const hitEffectDuration = 0.6; // Native prefab's destruction delay.

// Autoplay/export can seek anywhere without scanning every historical burst.
export function activeHitEffects(effects: readonly HitEffect[], time: number, speed = 1): readonly HitEffect[] {
  let low = 0, high = effects.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (effects[mid].time <= time - hitEffectDuration * speed) low = mid + 1;
    else high = mid;
  }
  const start = low;
  while (low < effects.length && effects[low].time <= time) low++;
  return effects.slice(start, low);
}

export function holdEffectInterval(note: RuntimeNote): number {
  if (note.holdInterval !== undefined) return note.holdInterval;
  const bpm = note.master.bpm;
  return Number.isFinite(bpm) && bpm! > 0 ? 30 / bpm! : 0.25;
}
// Reference schedule for seekable autoplay/export. A live manual Hold instead
// uses the actual frame delta in Judge.update (one emission, then reset to 0).
export function autoplayHoldTimes(note: RuntimeNote, speed = 1, fps = 60): number[] {
  const period = Math.max(1, Math.ceil((holdEffectInterval(note) - 0.00001) * fps * speed));
  const times: number[] = [];
  for (let frame = Math.floor(note.sect * fps) + period; frame / fps < note.hold_end_time; frame += period) {
    if (frame / fps > note.sect) times.push(frame / fps);
  }
  return times;
}
export function createHitEffect(note: RuntimeNote, time: number, grade: HitGrade): HitEffect {
  const seed = ((note.effectId ?? Math.round(note.sect * 1000 + note.positionX * 7919 + note.type * 104729)) ^ Math.round(time * 1000000)) >>> 0;
  return { note, time, grade, seed };
}
export function hitEffectPosition(effect: HitEffect, width: number, height: number): [number, number] {
  // Freeze the burst origin at the actual judgement/pulse time, in normalized coordinates.
  const [rotation, x, y] = effect.note.master.get_state(effect.time);
  const angle = rotation * Math.PI / 180;
  const viewport = effect.note.master.get_viewport?.();
  const geometry = effect.note.master.animation ? chartNoteGeometry(effect.note, effect.note.master.animation, effect.time,
    (effect.note.yOffset ?? 0) * 540, effect.note.is_above) : undefined;
  const offset = (geometry ? geometry.x / 1350 : effect.note.positionX * .05625) * (viewport?.width ?? width);
  let px = x * width + offset * Math.cos(angle), py = y * height + offset * Math.sin(angle);
  const yOffset = geometry ? geometry.y / 900 * height : (effect.note.yOffset ?? 0) * effect.note.speed * .6 * height;
  const normalAngle = angle + (effect.note.is_above ? -Math.PI / 2 : Math.PI / 2);
  px += Math.cos(normalAngle) * yOffset; py += Math.sin(normalAngle) * yOffset;
  const line = effect.note.master as RuntimeNote['master'] & { speedEvents?: Parameters<typeof get_fp>[1]; sec2beat?: (time: number) => number };
  // Hold.Judge uses the current Hold transform for its first feedback. An early
  // Hold is still above/below the line; Click.Judge explicitly snaps its head.
  if (effect.note.is_hold && effect.time < effect.note.sect && line.speedEvents && line.sec2beat && line.bpm) {
    const distance = ((effect.note.floorPosition ?? 0) - get_fp(line.sec2beat(effect.time), line.speedEvents)) *
      0.6 * (60 / 32 / line.bpm) * height * ((line as any).animation ? effect.note.speed : 1);
    const normal = angle + (effect.note.is_above ? -Math.PI / 2 : Math.PI / 2);
    px += Math.cos(normal) * distance; py += Math.sin(normal) * distance;
  }
  return [px, py];
}
