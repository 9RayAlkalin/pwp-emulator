import { describe, expect, it } from 'vitest';
import { Judge, scoreFor, timingGrade } from '../../src/gameplay/judge';
import type { RuntimeNote } from '../../src/gameplay/types';

const note = (type: 1 | 2 | 3 | 4, time = 1): RuntimeNote => ({
  type, time, holdTime: type === 3 ? 1 : 0, positionX: 0, speed: 1,
  sect: time, secht: type === 3 ? 1 : 0, hold_end_time: type === 3 ? time + 1 : time,
  is_hold: type === 3, is_above: true, clicked: false,
  master: { get_state: () => [0, 0.5, 0.5, 1] },
});
const input = (judge: Judge, time: number, kind: 'tap' | 'move' | 'release' = 'tap', keyboard = true, x = 500) =>
  judge.input('key', x, 250, kind, time, 1000, 500, keyboard);

describe('manual judgement', () => {
  it('uses the native early Bad and late Miss boundaries and caps the score', () => {
    expect(timingGrade(-0.079)).toBe('perfect');
    expect(timingGrade(-0.08)).toBe('good');
    expect(timingGrade(0.081)).toBe('good');
    expect(timingGrade(-0.17)).toBe('good');
    expect(timingGrade(-0.181)).toBe('bad');
    expect(timingGrade(0.181)).toBe('miss');
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
    judge.update(1.5); input(judge, 1.5, 'release');
    for (const t of [1.6, 1.61, 1.62, 1.63]) judge.update(t);
    judge.update(3);
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
  it('latches early Drag/Flick contacts and judges them when their beat arrives', () => {
    const judge = new Judge();
    judge.reset([note(2)]); input(judge, 0.91, 'tap', false); input(judge, 0.95, 'release', false);
    expect(judge.stats.perfect).toBe(0); judge.update(1);
    expect(judge.stats.perfect).toBe(1);
    judge.reset([note(4)]); input(judge, 0.86, 'tap', false); input(judge, 0.88, 'move', false, 520);
    input(judge, 0.9, 'release', false); judge.update(0.99); expect(judge.stats.perfect).toBe(0);
    judge.update(0.996); expect(judge.stats.perfect).toBe(1);
  });
  it('resets practice scoring and counts skipped notes as misses', () => {
    const judge = new Judge(); judge.reset([note(1), note(1, 2)], 1.5);
    expect(judge.stats.miss).toBe(1); expect(judge.stats.score).toBe(0);
    input(judge, 2); expect(judge.stats.perfect).toBe(1); expect(judge.stats.accuracy).toBe(50);
  });
});


describe('blocked fingers', () => {
  it('latches a blocked pointer until release even when it leaves the block', () => {
    const judge = new Judge();
    judge.isBlocked = x => x < 300;
    judge.reset([note(1), note(2, 1.1)]);
    input(judge, 1, 'tap', false, 200);
    expect(judge.stats.perfect).toBe(0);
    input(judge, 1.1, 'move', false, 500);
    expect(judge.stats.perfect).toBe(0);
    expect(judge.blockedTouches).toEqual([{ id: 'key', x: 500, y: 250 }]);
    input(judge, 1.1, 'release', false, 500);
    expect(judge.blockedTouches).toHaveLength(0);
    input(judge, 1.1, 'tap', false, 500);
    expect(judge.stats.perfect).toBe(1);
  });
  it('rechecks held contacts when a block activates without pointer movement', () => {
    const judge = new Judge();
    judge.isBlocked = (_x, _y, time) => time >= 1.2;
    const hold = note(3); judge.reset([hold]);
    input(judge, 1, 'tap', false);
    judge.update(1.3);
    expect(judge.blockedTouches).toHaveLength(1);
    expect(judge.stats.miss).toBe(0); // The blocked finger is removed immediately; Hold has frame grace.
    for (const time of [1.31, 1.32, 1.33]) judge.update(time);
    judge.update(1.4);
    expect(judge.stats.miss).toBe(1);
  });
  it('keeps other fingers working and does not invent a block position for keyboard input', () => {
    const judge = new Judge(); judge.isBlocked = x => x < 300;
    judge.reset([note(1)]);
    judge.input('blocked', 100, 250, 'tap', 0.9, 1000, 500, false);
    judge.input('free', 500, 250, 'tap', 1, 1000, 500, false);
    expect(judge.stats.perfect).toBe(1);
    expect(judge.blockedTouches).toHaveLength(1);
    judge.reset([note(1)]);
    input(judge, 1, 'tap', true, 100);
    expect(judge.stats.perfect).toBe(1);
    expect(judge.blockedTouches).toHaveLength(0);
    judge.clearInput(); expect(judge.blockedTouches).toHaveLength(0);
  });
});
