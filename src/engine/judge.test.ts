import { describe, expect, it } from 'vitest';
import { Judge, scoreFor, timingGrade } from './judge';
import type { RuntimeNote } from '../types';

const note = (type: 1 | 2 | 3 | 4, time = 1): RuntimeNote => ({
  type, time, holdTime: type === 3 ? 1 : 0, positionX: 0, speed: 1,
  sect: time, secht: type === 3 ? 1 : 0, hold_end_time: type === 3 ? time + 1 : time,
  is_hold: type === 3, is_above: true, clicked: false,
  master: { get_state: () => [0, 0.5, 0.5, 1] },
});
const input = (judge: Judge, time: number, kind: 'tap' | 'move' | 'release' = 'tap', keyboard = true, x = 500) =>
  judge.input('key', x, 250, kind, time, 1000, 500, keyboard);

describe('manual judgement', () => {
  it('uses symmetric timing windows and caps full-combo score at one million', () => {
    expect(timingGrade(-0.08)).toBe('perfect');
    expect(timingGrade(0.081)).toBe('good');
    expect(timingGrade(-0.161)).toBe('bad');
    expect(timingGrade(0.201)).toBe('miss');
    expect(scoreFor(100, 0, 100, 100)).toBe(1000000);
    expect(scoreFor(0, 100, 100, 100)).toBe(685000);
  });
  it('does not award automatic hits to taps and misses them once', () => {
    const judge = new Judge(); judge.reset([note(1)]);
    judge.update(1.1); expect(judge.stats.perfect).toBe(0);
    judge.update(1.21); judge.update(2);
    expect(judge.stats.miss).toBe(1);
  });
  it('requires pointer proximity and selects the nearest timed note', () => {
    const judge = new Judge(); const first = note(1), second = note(1, 1.1);
    judge.reset([first, second]); input(judge, 1.09, 'tap', false, 100);
    expect(judge.stats.perfect).toBe(0);
    input(judge, 1.09, 'tap', false);
    expect(judge.results.has(second)).toBe(true);
    expect(judge.results.has(first)).toBe(false);
  });
  it('requires sustained hold contact and gives one result per hold', () => {
    const judge = new Judge(); const hold = note(3); judge.reset([hold]);
    input(judge, 1); expect(judge.stats.perfect).toBe(0);
    judge.update(1.5); input(judge, 1.5, 'release'); judge.update(1.6); judge.update(3);
    expect(judge.stats.miss).toBe(1); expect(judge.stats.perfect).toBe(0);
    judge.reset([hold]); input(judge, 1); judge.update(1.9); judge.update(3);
    expect(judge.stats.perfect).toBe(1); expect(judge.stats.score).toBe(1000000);
  });
  it('catches drags with held contacts and requires movement for pointer flicks', () => {
    const judge = new Judge(); judge.reset([note(2)]); input(judge, 0.9, 'tap', false); judge.update(1);
    expect(judge.stats.perfect).toBe(1);
    judge.reset([note(4)]); input(judge, 1, 'tap', false); expect(judge.stats.perfect).toBe(0);
    input(judge, 1.01, 'move', false, 520); expect(judge.stats.perfect).toBe(1);
  });
  it('resets practice scoring and counts skipped notes as misses', () => {
    const judge = new Judge(); judge.reset([note(1), note(1, 2)], 1.5);
    expect(judge.stats.miss).toBe(1); expect(judge.stats.score).toBe(0);
    input(judge, 2); expect(judge.stats.perfect).toBe(1); expect(judge.stats.accuracy).toBe(50);
  });
});
