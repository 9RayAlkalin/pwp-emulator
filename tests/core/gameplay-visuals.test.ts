import { describe, expect, it } from 'vitest';
import { badNoteAlpha, gameplayMetrics, judgeLineColor, lateNoteAlpha, noteIsVisible, noteViewportScale, orderedNotes } from '../../src/core/gameplay-visuals';
import { autoplayHoldTimes } from '../../src/core/hit-effects';
import { createHitEffect, hitEffectPosition } from '../../src/core/hit-effects';
import { Judge } from '../../src/core/judge';
import type { RuntimeNote } from '../../src/types';

const note = (type: 1 | 2 | 3 | 4, time = 1): RuntimeNote => ({ type, sect: time, time, positionX: 0, speed: 1,
  holdTime: type === 3 ? 1 : 0, secht: type === 3 ? 1 : 0, hold_end_time: type === 3 ? time + 1 : time,
  is_hold: type === 3, is_above: true, clicked: false, master: { bpm: 100, get_state: () => [0, 0.5, 0.5, 1] } });
const tap = (judge: Judge, time: number) => judge.input('finger', 500, 250, 'tap', time, 1000, 500, true);

describe('native gameplay visuals', () => {
  it('uses AP/FC/white colors and makes the indicator switch override judgement status', () => {
    expect(judgeLineColor(true, { good: 0, bad: 0, miss: 0 })).toBe('#ffffb4');
    expect(judgeLineColor(true, { good: 1, bad: 0, miss: 0 })).toBe('#b3ecff');
    expect(judgeLineColor(true, { good: 1, bad: 0, miss: 1 })).toBe('#ffffff');
    expect(judgeLineColor(false, { good: 0, bad: 0, miss: 0 })).toBe('#ffffff');
    expect(gameplayMetrics.lineHalfLength * 2).toBe(5.76);
    expect(noteViewportScale(1600, 1000)).toBeCloseTo(0.9, 4);
    expect(noteViewportScale(2400, 1000)).toBe(1);
  });
  it('fades missed heads after crossing the line, with type-specific durations', () => {
    expect(lateNoteAlpha(note(1), 0.9)).toBe(1);
    expect(lateNoteAlpha(note(1), 1.08)).toBeCloseTo(0.5);
    expect(lateNoteAlpha(note(2), 1.05)).toBeCloseTo(0.5);
    expect(lateNoteAlpha(note(4), 1.11)).toBe(0);
    expect(noteIsVisible(note(1), undefined, 1.1, false)).toBe(true);
    expect(noteIsVisible(note(3), { grade: 'miss' }, 2.24, false)).toBe(true);
    expect(noteIsVisible(note(3), { grade: 'miss' }, 2.26, false)).toBe(false);
  });
  it('uses the original Bad alpha curve rather than inventing position/scale animation', () => {
    expect(badNoteAlpha(0)).toBe(1);
    expect(badNoteAlpha(gameplayMetrics.badDuration / 2)).toBeCloseTo(0.8470090674, 7);
    expect(badNoteAlpha(0.41666666)).toBe(0);
    const judge = new Judge(); judge.reset([note(1)]); tap(judge, 0.8);
    expect(judge.stats.bad).toBe(1); expect(judge.badEffects).toHaveLength(1);
    expect(judge.hitEffects).toHaveLength(0);
  });
  it('builds a global note queue with the farther Hold below ordinary heads', () => {
    const a = note(1), b = note(4), c = note(3), d = note(2);
    expect(orderedNotes([b, a, c, d])).toEqual([c, a, d, b]);
  });
  it('continues Hold feedback after early score completion and before the true tail', () => {
    const hold = note(3), judge = new Judge(); judge.reset([hold]); tap(judge, 1);
    for (const t of [1.3, 1.6, 1.79, 1.9]) judge.update(t);
    expect(judge.stats.perfect).toBe(1);
    expect(judge.hitEffects.map(effect => effect.time)).toContain(1.9);
    judge.input('finger', 0, 0, 'release', 1.91, 1000, 500, true);
    judge.update(1.92); judge.update(2.01);
    expect(judge.stats.miss).toBe(0); expect(judge.stats.perfect).toBe(1);
    expect(autoplayHoldTimes(hold)).toEqual([1.3, 1.6, 1.9]);
    expect(autoplayHoldTimes(hold, 2)).toEqual([1.6]);
  });
  it('keeps the feedback clock in real seconds while chart time runs at double speed', () => {
    const hold = note(3), judge = new Judge(); judge.reset([hold]); tap(judge, 1);
    judge.update(1.3, 1000, 500, 0.15);
    expect(judge.hitEffects.map(effect => effect.time)).toEqual([1]);
    judge.update(1.6, 1000, 500, 0.15);
    expect(judge.hitEffects.map(effect => effect.time)).toEqual([1.6]);
  });
  it('does not consume Hold grace on pointer events or repeated draws of the same frame', () => {
    const judge = new Judge(); judge.reset([note(3)]); tap(judge, 1); judge.update(1.1);
    judge.input('finger', 0, 0, 'release', 1.11, 1000, 500, true);
    for (let i = 0; i < 10; i++) judge.update(1.12);
    expect(judge.stats.miss).toBe(0);
    judge.update(1.13); judge.update(1.14); judge.update(1.15);
    expect(judge.stats.miss).toBe(1);
  });
  it('keeps manual animation ages on the playback wall clock across music speed changes', () => {
    const judge = new Judge(); let wall = 0; judge.now = () => wall;
    judge.reset([note(1)]); tap(judge, 1);
    wall = 0.1; judge.update(1.2, 1000, 500, 0.1);
    expect(judge.hitEffects[0].elapsed).toBe(0.1);
    wall = 0.2; judge.update(1.25, 1000, 500, 0.1);
    expect(judge.hitEffects[0].elapsed).toBe(0.2);
    wall = 0.61; judge.update(1.3, 1000, 500, 0.41);
    expect(judge.hitEffects).toHaveLength(0);
  });
  it('uses the still-moving Hold head for early feedback and the line for a Click', () => {
    const hold = note(3); hold.floorPosition = 64;
    Object.assign(hold.master, { bpm: 120, sec2beat: (t: number) => t * 64,
      speedEvents: [{ startTime: 0, endTime: 10000, floorPosition: 0, value: 1 }] });
    const early = hitEffectPosition(createHitEffect(hold, 0.9, 'perfect'), 1000, 500);
    expect(early[0]).toBe(500); expect(early[1]).toBeCloseTo(220);
    const tapNote = { ...hold, type: 1 as const, is_hold: false };
    expect(hitEffectPosition(createHitEffect(tapNote, 0.9, 'perfect'), 1000, 500)).toEqual([500, 250]);
  });
});
