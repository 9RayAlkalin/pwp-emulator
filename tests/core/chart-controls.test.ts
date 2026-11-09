import { expect, it } from 'vitest';
import { controlValue, createLineStateResolver, lineAppearance } from '../../src/core/chart-state';
import { parseChart } from '../../src/library/importer';
import { createHitEffect, hitEffectPosition } from '../../src/core/hit-effects';
import { Judge } from '../../src/core/judge';
import type { RuntimeNote } from '../../src/types';

const b = (n: number) => [n, 0, 1];
const text = (start: string, end: string, from = 0, to = 4, easingType = 1) => ({ start, end, startTime: b(from), endTime: b(to), easingType });
const chart = (line: unknown) => parseChart({ META: {}, BPMList: [{ startTime: b(0), bpm: 120 }], judgeLineList: [line] });

it('handles real RPE numeric prefixes, keeps suffix compatibility and preserves easing overshoot', () => {
  const line = chart({ extended: { textEvents: [text('%P%1', '%P%9000', 0, 4, 24)] } }).judgeLineList[0];
  expect(lineAppearance(line, 0).text).toBe('1');
  expect(Number(lineAppearance(line, .3).text)).toBeGreaterThan(10000);
  expect(lineAppearance(line, 2).text).toBe('9000');
  expect(lineAppearance(line, 0).text).toBe('1');
  const legacy = chart({ extended: { textEvents: [text('0%P%', '100%P%')] } }).judgeLineList[0];
  expect(lineAppearance(legacy, 1).text).toBe('50');
});

it('lets a newly started text event override an overlapping long event, including its font', () => {
  const line = chart({ extended: { textEvents: [
    { ...text('old', 'old', 0, 10), font: 'one.ttf' },
    { ...text('new', 'new', 2, 3), font: 'two.ttf' }, text('', 'next', 4, 6),
  ] } }).judgeLineList[0];
  expect(lineAppearance(line, .5)).toMatchObject({ text: 'old', font: 'one.ttf' });
  expect(lineAppearance(line, 1.2)).toMatchObject({ text: 'new', font: 'two.ttf' });
  expect(lineAppearance(line, 1.8).text).toBe('new');
  expect(lineAppearance(line, 2.5).text).toBe('ne');
  expect(lineAppearance(line, .5).text).toBe('old');
});

it('evaluates distance controls toward the line with each far keyframe easing and stable boundaries', () => {
  const points = [{ x: 0, value: 1, easing: 1 }, { x: 100, value: 2, easing: 2 }, { x: 200, value: .5, easing: 1 }];
  expect(controlValue(undefined, 50)).toBe(1);
  expect(controlValue(points, -100)).toBe(1);
  expect(controlValue(points, 50)).toBeCloseTo(2 - Math.SQRT1_2);
  expect(controlValue(points, 100)).toBe(2);
  expect(controlValue(points, 150)).toBe(1.25);
  expect(controlValue(points, 999)).toBe(.5);
});

it('retains parsed controls and aligns the on-line X multiplier between note judgement and feedback', () => {
  const line = chart({ posControl: [{ x: 100, pos: 1, easing: 2 }, { x: 0, pos: 2 }],
    alphaControl: [{ x: 0, alpha: .5 }], sizeControl: [{ x: 0, size: 1.5 }],
    notes: [{ type: 1, startTime: b(2), positionX: 100, tint: [106, 90, 205], tintHitEffects: [0, 255, 0], hitsound: 'bruh.wav' }],
  }).judgeLineList[0];
  expect(line.animation?.controls?.x?.map(p => p.x)).toEqual([0, 100]);
  expect(line.notesAbove[0]).toMatchObject({ tint: [106, 90, 205], tintHitEffects: [0, 255, 0], hitsound: 'bruh.wav' });
  const note: RuntimeNote = { ...line.notesAbove[0], positionX: 2, sect: 1, secht: 0, hold_end_time: 1,
    is_hold: false, is_above: true, clicked: false,
    master: { animation: line.animation, get_state: t => createLineStateResolver([line])(line, t) } };
  expect(hitEffectPosition(createHitEffect(note, 1, 'perfect'), 1000, 500)).toEqual([725, 250]);
  const judge = new Judge(); judge.reset([note]); judge.input('pointer', 725, 250, 'tap', 1, 1000, 500, false);
  expect(judge.stats.perfect).toBe(1);
});
