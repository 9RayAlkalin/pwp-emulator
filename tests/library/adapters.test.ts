import { describe, expect, it } from 'vitest';
import { parseChart } from '../../src/library/importer';
import { createLineStateResolver, lineAppearance } from '../../src/core/chart-state';
import { chartEase, easingProgress } from '../../src/core/chart-easing';
import { get_fp, init_speed_events } from '../../src/core/timeline';
import { Judge } from '../../src/core/judge';
import { noteIsVisible } from '../../src/core/gameplay-visuals';
import { autoplayHoldTimes } from '../../src/core/hit-effects';
import type { ChartLine, ChartNote, RuntimeNote } from '../../src/types';

const b = (n: number) => [n, 0, 1];
const e = (start: number, end = start, from = 0, to = 4, easingType = 1) => ({ startTime: b(from), endTime: b(to), start, end, easingType });
const rpe = (lines: unknown[] = [{ eventLayers: [{ moveXEvents: [e(0)], moveYEvents: [e(0)], rotateEvents: [e(0)], alphaEvents: [e(255)], speedEvents: [e(4.5)] }], notes: [] }]) => ({
  META: { RPEVersion: 170, offset: 250, name: 'RPE Song' },
  BPMList: [{ startTime: b(0), bpm: 120 }, { startTime: b(2), bpm: 60 }], judgeLineList: lines,
});
function runtime(note: ChartNote, line: ChartLine): RuntimeNote {
  return { ...note, sect: note.time, secht: note.holdTime, hold_end_time: note.time + note.holdTime,
    is_hold: note.type === 3, is_above: true, clicked: false,
    master: { bpm: line.bpm, animation: line.animation, get_state: time => createLineStateResolver([line])(line, time) } };
}

describe('PEC adapter', () => {
  it('converts beats, offset, coordinates, note types and modifiers without losing Hold BPM changes', () => {
    const chart = parseChart(`\uFEFF275\r\nbp 0 120 bp 2 60
      cp 0 0 1024 700 cv 0 0 7 ca 0 0 255
      cm 0 0 4 2048 1400 5
      n2 0 1 3 -115.2 1 0 # 2 & 1.5
      n3 0 3 0 2 1 n4 0 4 0 1 0 n1 0 2 0 1 0`);
    const line = chart.judgeLineList[0], hold = line.notesAbove[0];
    expect(chart.offset).toBeCloseTo(.1);
    expect(hold).toMatchObject({ type: 3, time: .5, holdTime: 1.5, positionX: -1, speed: 2, size: 1.5 });
    expect(line.notesBelow[0]).toMatchObject({ type: 4, isFake: true, time: 2 });
    expect(line.notesAbove.map(n => n.type)).toEqual([3, 2, 1]);
    const state = createLineStateResolver([line]);
    expect(state(line, 1.5)[1]).toBeCloseTo(.5 + .5 * .625 ** 2);
    expect(state(line, 1.5)[2]).toBeCloseTo(.5 - .5 * .625 ** 2);
    expect(state(line, 20).slice(1)).toEqual([1, 0, 1]);
    init_speed_events(line.speedEvents);
    expect(get_fp(0, line.speedEvents)).toBeCloseTo(0);
    expect(get_fp(2, line.speedEvents)).toBeCloseTo(2);
  });
  it('holds event values in gaps and samples the interrupted curve for an implicit start', () => {
    const chart = parseChart('175 bp 0 60 cp 0 0 1024 700 cm 0 0 4 2048 700 1 cm 0 2 3 0 700 1 cd 0 3 90 ca 0 4 -1');
    const line = chart.judgeLineList[0], state = createLineStateResolver([line]);
    expect(state(line, 2)[1]).toBeCloseTo(.75);
    expect(state(line, 2.5)[1]).toBeCloseTo(.375);
    expect(state(line, 4)[0]).toBe(90);
    expect(state(line, 4)[3]).toBeLessThan(0);
    expect(state(line, 1)[1]).toBeCloseTo(.625); // backwards seek
  });
  it('rejects broken commands, dangling modifiers, invalid BPM and backwards Holds', () => {
    for (const text of ['175 # 1', '175 bp 0 0 n1 0 1 0 1 0', '175 bp 0 120 n2 0 2 1 0 1 0', '175 bp 0 120 wat 0']) expect(() => parseChart(text)).toThrow();
  });
});

describe('RPE adapter', () => {
  it('keeps signed visibleTime for hidden notes without removing their judgement or count', () => {
    const chart = parseChart(rpe([{ notes: [
      { type: 1, startTime: b(2), visibleTime: -10 },
      { type: 4, startTime: b(2), visibleTime: -.06768244504928589 },
      { type: 2, startTime: b(2), endTime: b(4), visibleTime: -.1 },
    ] }]));
    const line = chart.judgeLineList[0], notes = line.notesAbove.map(note => runtime(note, line));
    expect(line.notesAbove.map(n => n.visibleTime)).toEqual([-10, -.06768244504928589, -.1]);
    for (const note of notes) {
      expect(noteIsVisible(note, undefined, note.sect - .01, true)).toBe(false);
      expect(noteIsVisible(note, undefined, note.sect, true)).toBe(false);
    }
    expect(noteIsVisible(notes[2], undefined, 1.11, true)).toBe(true);
    const judge = new Judge(); judge.reset(notes); expect(judge.stats.total).toBe(3);
    judge.update(10); expect(judge.stats.miss).toBe(3);
    expect(() => parseChart(rpe([{ notes: [{ type: 1, startTime: b(2), visibleTime: NaN }] }]))).toThrow('visibleTime');
    expect(() => parseChart(rpe([{ notes: [{ type: 1, startTime: b(2), size: -1 }] }]))).toThrow('宽度');
  });
  it('normalizes descending easing crops without swapping endpoints or falling back to the full curve', () => {
    const event = { ...e(-10, 0, 0, 2, 6), easingLeft: 1, easingRight: .5 };
    const chart = parseChart(rpe([{ eventLayers: [{ moveXEvents: [event] }] }]));
    const state = createLineStateResolver(chart.judgeLineList), line = chart.judgeLineList[0];
    expect(easingProgress(0, { type: 6, left: 1, right: .5 })).toBeCloseTo(0);
    expect(easingProgress(.5, { type: 6, left: 1, right: .5 })).toBeCloseTo(1 - Math.SQRT1_2);
    expect(easingProgress(1, { type: 6, left: 1, right: .5 })).toBe(1);
    expect(state(line, .5)[1]).toBeCloseTo(.5 - Math.SQRT1_2 * 10 / 1350);
    expect(state(line, 1)[1]).toBe(.5);
    expect(state(line, .5)[1]).toBeCloseTo(.5 - Math.SQRT1_2 * 10 / 1350);
    for (const crop of [{ easingLeft: 1.1 }, { easingRight: -.1 }]) {
      expect(() => parseChart(rpe([{ eventLayers: [{ moveXEvents: [{ ...event, ...crop }] }] }]))).toThrow('0–1');
    }
  });
  it('keeps authored initial transforms during offset lead-in so a parked future Hold stays offscreen', () => {
    const raw = rpe([{ eventLayers: [{ moveXEvents: [e(1318.359375)], moveYEvents: [e(1285.7142857142858)],
      rotateEvents: [e(20)], alphaEvents: [e(0)], speedEvents: [e(4.5)] }],
      extended: { scaleXEvents: [e(2)], scaleYEvents: [e(.5)], colorEvents: [{ ...e(0), start: [120, 180, 220], end: [120, 180, 220] }] },
      notes: [{ type: 2, startTime: b(289), endTime: [289, 1, 2], isFake: 1 }] }]);
    raw.META.offset = 1315;
    const chart = parseChart(raw), line = chart.judgeLineList[0], state = createLineStateResolver([line]);
    expect(state(line, -chart.offset)).toEqual(state(line, 0));
    expect(state(line, -chart.offset)[1]).toBeGreaterThan(1);
    expect(state(line, -chart.offset)[2]).toBeLessThan(0);
    expect(lineAppearance(line, -chart.offset)).toMatchObject({ scaleX: 2, scaleY: .5, color: 'rgb(120,180,220)' });
    init_speed_events(line.speedEvents);
    expect(get_fp(-chart.offset, line.speedEvents)).toBe(0);
    expect(get_fp(0, line.speedEvents)).toBe(0);
  });
  it('uses the earliest initial transform without advancing future events or losing negative-time animation', () => {
    const chart = parseChart(rpe([{ eventLayers: [{ moveXEvents: [e(675, 0, 2, 4), e(135, 270, 0, 2)],
      moveYEvents: [e(90, 180, 2, 4)], rotateEvents: [e(20, 40, -2, 0)] }] }]));
    const line = chart.judgeLineList[0], state = createLineStateResolver([line]);
    expect(state(line, -2).slice(0, 3)).toEqual([20, .6, .5]);
    expect(state(line, -.5)[0]).toBeCloseTo(30);
    expect(state(line, 0).slice(0, 3)).toEqual([40, .6, .5]);
    expect(state(line, 1)[1]).toBe(1);
    expect(state(line, 1)[2]).toBeCloseTo(.4);
  });
  it.each([1315, -250, 0])('places beat zero at music time META.offset=%i ms without changing event or note beats', offset => {
    const raw = rpe([{ eventLayers: [{ moveXEvents: [e(0, 675, 0, 2)] }], notes: [{ type: 1, startTime: b(1) }] }]);
    raw.META.offset = offset;
    const chart = parseChart(raw), line = chart.judgeLineList[0], state = createLineStateResolver([line]);
    expect(chart.offset).toBeCloseTo(offset / 1000);
    expect(line.notesAbove[0].time).toBe(.5);
    const hitMusicTime = .5 + offset / 1000;
    expect(hitMusicTime - chart.offset).toBeCloseTo(.5);
    expect(state(line, hitMusicTime - chart.offset)[1]).toBeCloseTo(.75);
  });
  it('preserves layered XY curves across tempo changes and integrates linear speeds with bpmfactor', () => {
    const raw = rpe([{ bpmfactor: 2, eventLayers: [
      { moveXEvents: [e(0, 675, 0, 4, 5)], alphaEvents: [e(255)], speedEvents: [e(4.5, 9)] },
      { moveYEvents: [e(225)], alphaEvents: [e(-64)], speedEvents: [e(4.5)] }, null,
    ], notes: [
      { type: 2, startTime: [2, 1, 2], endTime: b(4), positionX: 75.9375, speed: 2, above: 1 },
      { type: 3, startTime: b(2), isFake: 1, above: 2, alpha: 128, size: 1.4 },
      { type: 4, startTime: b(1) },
    ] }]);
    const chart = parseChart(raw), line = chart.judgeLineList[0], state = createLineStateResolver([line]);
    expect(chart.offset).toBe(.25);
    expect(line.notesAbove[0]).toMatchObject({ type: 3, time: 3, holdTime: 3, positionX: 1, speed: 2 });
    expect(line.notesAbove[1].type).toBe(2);
    expect(line.notesBelow[0]).toMatchObject({ type: 4, time: 2, isFake: true, size: 1.4 });
    expect(state(line, 3)[1]).toBeCloseTo(.5 + .5 * .625 ** 2);
    expect(state(line, 3)[2]).toBeCloseTo(.25);
    expect(state(line, 3)[3]).toBeCloseTo(191 / 255);
    expect(state(line, -1)[1]).toBe(.5);
    init_speed_events(line.speedEvents);
    expect(get_fp(0, line.speedEvents)).toBeCloseTo(0);
    expect(get_fp(6, line.speedEvents)).toBeCloseTo(15.5);
    expect((raw.judgeLineList[0] as any).notes[0].startTime).toEqual([2, 1, 2]);
  });
  it('handles nested parent coordinates and explicit rotation inheritance', () => {
    const root = { eventLayers: [{ moveXEvents: [e(135)], rotateEvents: [e(90)], alphaEvents: [e(255)] }] };
    const child = { father: 0, eventLayers: [{ moveXEvents: [e(135)], rotateEvents: [e(5)] }] };
    const chart = parseChart(rpe([root, child, { father: 1, rotateWithFather: true, eventLayers: [] }]));
    const state = createLineStateResolver(chart.judgeLineList);
    const c = state(chart.judgeLineList[1], 1);
    expect(c[0]).toBe(5); expect(c[1]).toBeCloseTo(.6); expect(c[2]).toBeCloseTo(.5 + .1 * 16 / 9);
    expect(state(chart.judgeLineList[2], 1).slice(0, 3)).toEqual(c.slice(0, 3));
  });
  it('evaluates all easing endpoints, easing crops, Bezier inversion, and extended line appearance', () => {
    for (let type = 1; type <= 29; type++) {
      expect(chartEase(0, type)).toBe(0); expect(chartEase(1, type)).toBe(1);
      expect(Number.isFinite(chartEase(.37, type))).toBe(true);
    }
    expect(easingProgress(.5, { type: 5, left: .25, right: .75 })).toBeCloseTo(.375);
    expect(easingProgress(.5, { type: 1, bezier: [.5, 0, .5, 1] })).toBeCloseTo(.5);
    const chart = parseChart(rpe([{ eventLayers: [], extended: {
      scaleXEvents: [e(1, 2)], scaleYEvents: [e(2)],
      colorEvents: [{ ...e(0), start: [255, 0, 0], end: [0, 0, 255] }],
      textEvents: [{ ...e(0), start: '0%P%', end: '100%P%' }],
    } }]));
    const appearance = lineAppearance(chart.judgeLineList[0], 1);
    expect(appearance).toMatchObject({ scaleX: 1.5, scaleY: 2, color: 'rgb(128,0,128)', text: '50' });
    expect(lineAppearance(chart.judgeLineList[0], 10).text).toBe('100');
  });
  it('rejects invalid rational beats, BPM factors, and cyclic parents', () => {
    const invalid = rpe(); invalid.BPMList[0].startTime = [0, 1, 0];
    expect(() => parseChart(invalid)).toThrow('beat');
    expect(() => parseChart(rpe([{ bpmfactor: 0 }]))).toThrow('bpmfactor');
    expect(() => parseChart(rpe([{ father: 1 }, { father: 0 }]))).toThrow('循环');
  });
  it('keeps custom textures, anchors and UI bindings, with GIF events active only during their original intervals', () => {
    const chart = parseChart(rpe([{ Texture: 'images/anim.gif', anchor: [0, 1], attachUI: 'score',
      extended: { gifEvents: [e(0, 1, 1, 3)] } },
    { Texture: 'missing.png', extended: { textEvents: [{ ...e(0), start: 'text', end: 'text' }] } }]));
    const line = chart.judgeLineList[0];
    expect(line.animation).toMatchObject({ texture: 'images/anim.gif', anchor: [0, 1], attachUI: 'score' });
    expect(chart.judgeLineList[1].animation?.texture).toBeUndefined();
    expect(lineAppearance(line, .1).gifProgress).toBeUndefined();
    expect(lineAppearance(line, 1).gifProgress).toBeCloseTo(.5);
    expect(lineAppearance(line, 2.1).gifProgress).toBeUndefined();
    expect(chart.warnings).toEqual([]);
    expect(() => parseChart(rpe([{ anchor: [1] }]))).toThrow('anchor');
  });
  it('retains fake notes visually while excluding them from judgement, score and feedback', () => {
    const chart = parseChart(rpe([{ eventLayers: [], notes: [
      { type: 1, startTime: b(1), isFake: 1, visibleTime: .2 },
      { type: 2, startTime: b(1), endTime: b(4) },
    ] }]));
    const line = chart.judgeLineList[0], fake = runtime(line.notesAbove[0], line), hold = runtime(line.notesAbove[1], line);
    const judge = new Judge(); judge.reset([fake, hold]);
    expect(judge.stats.total).toBe(1); expect(judge.notes).toEqual([hold]);
    expect(noteIsVisible(fake, undefined, .2, false)).toBe(false);
    expect(noteIsVisible(fake, undefined, .4, false)).toBe(true);
    expect(noteIsVisible(fake, undefined, .6, false)).toBe(false);
    expect(autoplayHoldTimes(hold).length).toBeGreaterThan(1);
    judge.update(10); expect(judge.stats.miss).toBe(1);
    expect(judge.hitEffects).toHaveLength(0);
  });
  it('removes adapted Hold tails at the true end without a quarter-second residual sprite', () => {
    const line = parseChart(rpe([{ notes: [{ type: 2, startTime: b(1), endTime: b(4) }] }])).judgeLineList[0];
    const hold = runtime(line.notesAbove[0], line);
    expect(hold.hold_end_time).toBe(3);
    expect(noteIsVisible(hold, undefined, 2.999, true)).toBe(true);
    for (const t of [3, 3.05, 3.24]) {
      expect(noteIsVisible(hold, undefined, t, true)).toBe(false);
      expect(noteIsVisible(hold, { grade: 'perfect' }, t, false)).toBe(false);
      expect(noteIsVisible({ ...hold, isFake: true }, undefined, t, false)).toBe(false);
    }
    const pecLine = parseChart('175 bp 0 120 cv 0 0 7 n2 0 2 4 0 1 0').judgeLineList[0];
    const pecHold = runtime(pecLine.notesAbove[0], pecLine);
    expect(noteIsVisible(pecHold, undefined, 2.01, true)).toBe(false);
  });
});
