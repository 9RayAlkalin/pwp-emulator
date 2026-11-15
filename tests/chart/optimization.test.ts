import { expect, it } from 'vitest';
import type { ChartEvent } from '../../src/chart/types';
import { easingProgress } from '../../src/chart/animation/easing';
import { eventIntegral } from '../../src/chart/animation/integral';
import { find_event, get_fp, init_speed_events } from '../../src/chart/animation/timeline';
import { combineSpeeds, compileTrack, TempoMap } from '../../src/chart/formats/compiler';
import { controlValue } from '../../src/chart/animation/state';

it('keeps bounded cursor lookup equivalent to a full search across boundaries, gaps and seeks', () => {
  const events = Array.from({ length: 1000 }, (_, i) => ({ startTime: i * 2, endTime: i * 2 + 1 }));
  for (const time of [-Infinity, 0, 1, 2, 3, 1500, 20, 19, 2000, Infinity, -10]) {
    const index = events.findIndex(event => event.endTime > time);
    expect(find_event(time, events)).toBe(index < 0 ? events.length - 1 : index);
  }
  expect(find_event(0, [])).toBe(-1);
});

it('matches numerical integration for exact easing families, cropped ranges and split progress', () => {
  for (let type = 1; type <= 21; type++) for (const extra of [{}, { left: .15, right: .85 }, { from: .2, to: .7 }, { left: .3, right: .3 }]) {
    const easing = { type, ...extra }, event: ChartEvent = { startTime: 0, endTime: 2, start: -2, end: 5, easing };
    const steps = 4000;
    let numeric = 0;
    for (let i = 0; i < steps; i++) numeric += (-2 + 7 * easingProgress((i + .5) / steps, easing)) * 2 / steps;
    expect(eventIntegral(event, 0, 2), `curve ${type} ${JSON.stringify(extra)}`).toBeCloseTo(numeric, 4);
  }
});

it('keeps eased speed tracks compact and continuous across BPM boundaries and layered negative time', () => {
  const tempo = new TempoMap([{ beat: 0, bpm: 60 }, { beat: 1, bpm: 120 }]);
  const track = compileTrack([{ startTime: -1, endTime: 3, start: 0, end: 4, easing: { type: 5 } }], tempo);
  const speeds = combineSpeeds([track, compileTrack([], tempo, 2)]);
  expect(speeds.length).toBeLessThan(10);
  init_speed_events(speeds);
  expect(get_fp(0, speeds)).toBeCloseTo(0, 8);
  // Compare against an independent midpoint quadrature of the authored curve.
  const expected = (time: number) => {
    const steps = 20000, dt = time / steps;
    let total = 0;
    for (let i = 0; i < steps; i++) {
      const t = (i + .5) * dt, beat = t < 1 ? t : 1 + (t - 1) * 2;
      total += (2 + 4 * ((beat + 1) / 4) ** 2) * dt;
    }
    return total;
  };
  for (const t of [1.75, .2, 1, -.5, 1.999]) expect(get_fp(t, speeds)).toBeCloseTo(expected(t), 6);
});

it('retains bounded sampling for bezier and elastic speed curves', () => {
  for (const easing of [{ type: 24 }, { type: 1, bezier: [.2, .1, .8, .9] }]) {
    const speeds = combineSpeeds([[{ startTime: 0, endTime: 1, start: 0, end: 1, easing }]]);
    expect(speeds).toHaveLength(240);
    expect(speeds.every(event => !event.speedCurves)).toBe(true);
  }
});

it('preserves control easing and duplicate-distance boundaries with constant fast paths', () => {
  const points = [{ x: 0, value: 2, easing: 1 }, { x: 10, value: 4, easing: 5 }, { x: 10, value: 8, easing: 1 }, { x: 20, value: 6, easing: 1 }];
  expect(controlValue(points, 5)).toBe(3.5);
  expect(controlValue(points, 10)).toBe(4);
  expect(controlValue(points, 15)).toBe(7);
  expect(controlValue(points, 100)).toBe(6);
  const constant = points.map(point => ({ ...point, value: 1 }));
  for (const distance of [-100, 0, 10, 100]) expect(controlValue(constant, distance)).toBe(1);
});
