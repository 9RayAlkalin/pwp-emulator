import { expect, it } from 'vitest';
import { isZepcChart, parseZepcChart } from '../../../src/chart/formats/zepc';
import { isZepcManifest } from '../../../src/chart/formats/manifest';
import { get_event_val } from '../../../src/chart/animation/timeline';

const chart = (overrides: Record<string, unknown> = {}) => ({
  zepcVersion: 1,
  timing: 'beats',
  bpm: 120,
  offset: 0.1,
  aspectRatio: 1.5,
  script: ['main.lua'],
  line: [{
    move: [{ beat: 0, x: 0.25, y: 0.5, toX: 0.75, toY: 0.5, endBeat: 2 }],
    rotate: [{ beat: 0, value: 30, to: 90, endBeat: 2 }],
    alpha: [{ beat: 1, value: 0.5, to: 1, endBeat: 3 }],
    speed: [{ beat: 0, value: 2 }],
    note: [
      { type: 1, beat: 1, x: 0.5, highlight: 2 },
      { type: 3, beat: 2, holdBeats: 2, x: 1, tint: '#ff0000', tintHitEffects: [0, 0, 255] },
      { type: 2, beat: 2, x: 0, above: false },
    ],
  }],
  ...overrides,
});

it('recognises ZEPC charts by zepcVersion or line, without format fields', () => {
  expect(isZepcChart({ zepcVersion: 1, line: [] })).toBe(true);
  expect(isZepcChart({ line: [] })).toBe(true);
  expect(isZepcChart({ name: 'Song', difficulties: {} })).toBe(false);
  expect(isZepcChart({ format: 'pwp-chart', lines: [] })).toBe(false);
  expect(isZepcChart(null)).toBe(false);
  expect(isZepcManifest({ name: 'Song', difficulties: {} })).toBe(true);
  expect(isZepcManifest({ zepcVersion: 1, line: [] })).toBe(false);
});

it('compiles beats, tempo, and line tracks into the existing chart runtime', () => {
  const data = parseZepcChart(chart());
  expect(data.sourceFormat).toBe('zepc');
  expect(data.offset).toBe(0.1);
  expect(data.aspectRatio).toBe(1.5);
  expect((data as any).zepc.script).toEqual(['main.lua']);
  expect(data.judgeLineList).toHaveLength(1);

  const line = data.judgeLineList[0];
  expect(line.bpm).toBeCloseTo(60 / 32);
  expect(get_event_val(0.5, line.animation!.x[0], 'start', 'end')).toBeCloseTo(0);
  expect(get_event_val(1, line.animation!.x[0], 'start', 'end')).toBeCloseTo(0.25);
  expect(get_event_val(0.5, line.animation!.rotation[0], 'start', 'end')).toBeCloseTo(60);
  expect(line.speedEvents[0].value).toBeCloseTo(2);
  expect(line.speedEvents.length).toBeGreaterThan(0);

  const [tap, hold] = line.notesAbove;
  expect(tap.type).toBe(1);
  expect(tap.time).toBeCloseTo(0.5);
  expect(tap.positionX).toBe(0);
  expect(tap.highlight).toBe(2);
  expect(hold.type).toBe(3);
  expect(hold.time).toBeCloseTo(1);
  expect(hold.holdTime).toBeCloseTo(1);
  expect(hold.positionX).toBeCloseTo(8.888888, 5);
  expect(hold.tint).toEqual([255, 0, 0]);
  expect(hold.tintHitEffects).toEqual([0, 0, 255]);

  const drag = line.notesBelow[0];
  expect(drag.type).toBe(2);
  expect(drag.time).toBeCloseTo(1);
  expect(drag.positionX).toBeCloseTo(-8.888888, 5);
});

it('accepts numeric Phigros ease ids and rejects out-of-range values', () => {
  const data = parseZepcChart(chart({ line: [{
    rotate: [{ beat: 0, angle: 0, to: 90, endBeat: 2, easing: 6 }],
  }] }));
  expect(data.judgeLineList[0].animation!.rotation[0].some(event => event.easing?.type === 6)).toBe(true);
  expect(() => parseZepcChart(chart({ line: [{ rotate: [{ beat: 0, easing: 30 }] }] }))).toThrow('1–29');
  expect(() => parseZepcChart(chart({ line: [{ rotate: [{ beat: 0, easing: 2.5 }] }] }))).toThrow('1–29');
});

it('supports seconds timing and BPM changes', () => {
  const seconds = parseZepcChart(chart({ timing: 'seconds', bpm: 999, line: [{
    note: [{ type: 1, beat: 2 }],
  }] }));
  expect(seconds.judgeLineList[0].notesAbove[0].time).toBe(2);

  const values = parseZepcChart(chart({ bpmList: [{ beat: 0, bpm: 120 }, { beat: 2, bpm: 240 }], line: [{
    note: [{ type: 1, beat: 4 }],
  }] }));
  expect(values.judgeLineList[0].notesAbove[0].time).toBeCloseTo(1.5);
});

it('keeps the fallback pose during a positive lead-in', () => {
  const data = parseZepcChart(chart({ line: [{
    move: [{ beat: 1, x: 0.2, y: 0.8, endBeat: 2 }],
  }] }));
  const x = data.judgeLineList[0].animation!.x[0];
  expect(get_event_val(0, x, 'start', 'end')).toBeCloseTo(0);
  expect(get_event_val(0.5, x, 'start', 'end')).toBeCloseTo(-0.3);
  expect(get_event_val(1, x, 'start', 'end')).toBeCloseTo(-0.3);
});

it('uses canonical keys only and validates timing, parents, and note positions', () => {
  expect(() => parseZepcChart({ zepcVersion: 1, line: [] })).toThrow('line');
  expect(() => parseZepcChart(chart({ zepcVersion: 2 }))).toThrow('版本');
  expect(() => parseZepcChart(chart({ timing: 'ticks' }))).toThrow('timing');
  expect(() => parseZepcChart(chart({ line: [{ father: 2 }, {}] }))).toThrow('父线');
  expect(() => parseZepcChart(chart({ line: [{ father: 1 }, { father: 0 }] }))).toThrow('循环引用');
  expect(() => parseZepcChart(chart({ line: [{ note: [{ type: 1, beat: 0, x: 2 }] }] }))).toThrow('x 必须为 0–1');
  expect(() => parseZepcChart(chart({ line: [{ note: [{ type: 9, beat: 0 }] }] }))).toThrow('1–4');
  expect(() => parseZepcChart(chart({ line: [{ note: [{ beat: 0 }] }] }))).toThrow('1–4');
  expect((parseZepcChart(chart({ lines: [], notes: [] })) as any).zepc.script).toEqual(['main.lua']);
});
