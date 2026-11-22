import { expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../../schema/zepc-v2.schema.json';

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
ajv.addSchema(schema, schema.$id);
const bundle = ajv.compile({ $ref: `${schema.$id}#/$defs/bundle` });
const chart = ajv.compile({ $ref: `${schema.$id}#/$defs/chart` });

const baseBundle = () => ({
  zepcVersion: 2,
  kind: 'bundle',
  name: 'Song',
  assets: [
    { id: 'music-main', type: 'audio', path: 'assets/music.ogg' },
    { id: 'chart-in', type: 'chart', path: 'charts/in.chart.yaml' },
  ],
  difficulties: [{ id: 'in', name: 'IN', level: 14, chart: 'chart-in' }],
});

const baseChart = () => ({
  zepcVersion: 2,
  kind: 'chart',
  id: 'chart-in',
  timing: { bpm: 120 },
  lines: [{
    id: 'main',
    eventLayers: [],
    notes: [{ id: 'n1', type: 'tap', beat: 4, x: 0.5 }],
  }],
});

it('accepts strict v2 bundle and chart documents', () => {
  expect(bundle(baseBundle())).toBe(true);
  expect(chart(baseChart())).toBe(true);
});

it('accepts layered events with independent timing and easing for each axis', () => {
  expect(chart({ ...baseChart(), lines: [{
    id: 'main',
    eventLayers: [{ id: 'base', events: {
      positionX: [{ startBeat: 0, endBeat: 4, from: 0, to: 0.25, easing: 1 }],
      positionY: [{ startBeat: 1, endBeat: 3, from: 0, to: -0.25, easing: 9 }],
      scaleX: [{ startBeat: 0, endBeat: 2, from: 1, to: 1.25, easing: 3 }],
      scaleY: [{ startBeat: 2, endBeat: 3, from: 1, to: 0.75, easing: 6 }],
    } }, { id: 'shake', events: {
      positionX: [{ startBeat: 2, endBeat: 2.25, from: 0, to: 0.03 }],
      color: [{ startBeat: 0, endBeat: 0, from: [255, 255, 255], to: [255, 0, 0] }],
      text: [{ startBeat: 4, endBeat: 5, from: '', to: 'GO', font: 'hud-font' }],
    } }],
    notes: [],
  }, {
    id: 'child', parent: 'main',
    eventLayers: [{ id: 'base', events: { positionY: [{ startBeat: 2, endBeat: 2, from: 0, to: 0.25 }] } }],
    notes: [],
  }] })).toBe(true);
});

it('rejects flat tracks, unknown layer fields and the former event timing fields', () => {
  const line = baseChart().lines[0];
  expect(chart({ ...baseChart(), lines: [{ ...line, tracks: {} }] })).toBe(false);
  expect(chart({ ...baseChart(), lines: [{
    ...line, eventLayers: [{ id: 'base', events: {}, blend: 'add' }],
  }] })).toBe(false);
  expect(chart({ ...baseChart(), lines: [{
    ...line, eventLayers: [{ events: {} }],
  }] })).toBe(false);
  expect(chart({ ...baseChart(), lines: [{
    ...line, eventLayers: [{ id: 'base', events: {
      rotation: [{ beat: 0, duration: 2, from: 0, to: 90 }],
    } }],
  }] })).toBe(false);
});

it.each(['position', 'scale'])('rejects the combined %s track', key => {
  expect(chart({ ...baseChart(), lines: [{
    id: 'main', eventLayers: [{ id: 'base', events: { [key]: [] } }], notes: [],
  }] })).toBe(false);
  expect(chart.errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ keyword: 'additionalProperties', params: { additionalProperty: key } }),
  ]));
});

it.each(['positionX', 'positionY', 'scaleX', 'scaleY'])('rejects vector values on %s', key => {
  expect(chart({ ...baseChart(), lines: [{
    id: 'main',
    eventLayers: [{ id: 'base', events: {
      [key]: [{ startBeat: 0, endBeat: 2, from: { x: 0, y: 0 }, to: { x: 0.25, y: -0.25 } }],
    } }],
    notes: [],
  }] })).toBe(false);
  const eventPath = `/lines/0/eventLayers/0/events/${key}/0`;
  expect(chart.errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ keyword: 'type', instancePath: `${eventPath}/from` }),
    expect.objectContaining({ keyword: 'type', instancePath: `${eventPath}/to` }),
  ]));
});

it('rejects unknown keys and numeric note types', () => {
  expect(bundle({ ...baseBundle(), extra: true })).toBe(false);
  expect(chart({ ...baseChart(), lines: [{
    id: 'main', eventLayers: [], notes: [{ id: 'n1', type: 1, beat: 4, x: 0.5 }],
  }] })).toBe(false);
});

it('requires duration only for hold notes', () => {
  expect(chart({ ...baseChart(), lines: [{
    id: 'main', eventLayers: [], notes: [{ id: 'n1', type: 'hold', beat: 4, x: 0.5 }],
  }] })).toBe(false);
  expect(chart({ ...baseChart(), lines: [{
    id: 'main', eventLayers: [], notes: [{ id: 'n1', type: 'hold', beat: 4, x: 0.5, duration: 2 }],
  }] })).toBe(true);
  expect(chart({ ...baseChart(), lines: [{
    id: 'main', eventLayers: [], notes: [{ id: 'n1', type: 'tap', beat: 4, x: 0.5, duration: 2 }],
  }] })).toBe(false);
});

it('rejects array anchors and accepts point objects', () => {
  expect(chart({ ...baseChart(), lines: [{
    id: 'main', anchor: [0.5, 0.5], eventLayers: [], notes: [],
  }] })).toBe(false);
  expect(chart({ ...baseChart(), lines: [{
    id: 'main', anchor: { x: 0.5, y: 0.5 }, eventLayers: [], notes: [],
  }] })).toBe(true);
});
