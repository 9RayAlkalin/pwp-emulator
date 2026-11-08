import { expect, it } from 'vitest';
import { chartViewport, resolveChartAspect } from '../../src/core/chart-viewport';
import { gameHudLayout, hudAttachment } from '../../src/core/chart-hud';
import { createLineStateResolver } from '../../src/core/chart-state';
import { parseChart } from '../../src/library/importer';
import { Judge } from '../../src/core/judge';
import { createHitEffect, hitEffectPosition } from '../../src/core/hit-effects';
import type { RuntimeNote } from '../../src/types';
import { defaults, loadSettings, saveSettings } from '../../src/settings';

it('keeps image pixels square and caps ultrawide canvases at the chart aspect', () => {
  const normal = chartViewport(1920, 1080), wide = chartViewport(2520, 1080), narrow = chartViewport(1440, 1080);
  expect(wide).toMatchObject({ left: 300, width: 1920, height: 1080 });
  expect(wide.textureScale).toBe(normal.textureScale);
  expect(narrow.textureScale / normal.textureScale).toBeCloseTo(.75);
  const portrait = chartViewport(1080, 1920);
  expect(portrait.width).toBe(1080); expect(portrait.textureScale).toBe(.8);
  expect(chartViewport(3840, 2160).textureScale / normal.textureScale).toBe(2);
  expect(chartViewport(1920, 1080, 4 / 3)).toMatchObject({ left: 240, width: 1440 });
});

it('keeps HUD sizes fixed while moving side anchors inside chart cover bounds', () => {
  for (const [w, h] of [[1440, 1080], [2520, 1080], [1080, 1920], [3840, 2160]]) {
    const vp = chartViewport(w, h), hud = gameHudLayout(w, h, vp);
    expect(hud.scale).toBe(h / 1000);
    expect(hud.pause.width * hud.scale / h).toBeCloseTo(.034262);
    expect((hud.height - hud.song.y) * hud.scale / h).toBeCloseTo(.0498);
    expect(hud.left * hud.scale).toBeCloseTo(vp.left, 6);
    expect(hud.right * hud.scale).toBeCloseTo(vp.left + vp.width, 6);
    expect(hud.cover.left).toBe(hud.left); expect(hud.cover.right).toBe(hud.right);
  }
  // A 4:3 chart moves side controls inward, but keeps their original size.
  const vp = chartViewport(1920, 1080, 4 / 3), hud = gameHudLayout(1920, 1080, vp), native = gameHudLayout(1920, 1080);
  expect(vp.left).toBe(240);
  expect(hud.left * hud.scale).toBeCloseTo(240, 4);
  expect(hud.pause.width * hud.scale).toBeCloseTo(37.00296);
  expect(hud.pause.width).toBe(native.pause.width); expect(hud.scale).toBe(native.scale);
  expect((hud.pause.x - native.pause.x) * hud.scale).toBeCloseTo(240, 4);
  expect((native.score.x - hud.score.x) * hud.scale).toBeCloseTo(240, 4);
  expect((hud.song.x - native.song.x) * hud.scale).toBeCloseTo(240, 4);
  expect((native.level.x - hud.level.x) * hud.scale).toBeCloseTo(240, 4);
  expect(hud.combo).toEqual(native.combo); expect(hud.combo_text).toEqual(native.combo_text);
});

it('reprojects rotated parents after an aspect change even at the same paused chart time', () => {
  const b = (n: number) => [n, 0, 1];
  const e = (n: number) => ({ startTime: b(0), endTime: b(10), start: n, end: n });
  const chart = parseChart({ META: {}, BPMList: [{ startTime: b(0), bpm: 120 }], judgeLineList: [
    { eventLayers: [{ rotateEvents: [e(90)] }] },
    { father: 0, attachUI: 'pause', eventLayers: [{ moveXEvents: [e(135)], moveYEvents: [e(90)], alphaEvents: [e(255)] }] },
  ] });
  let vp = chartViewport(1920, 1080);
  const state = createLineStateResolver(chart.judgeLineList, () => vp.aspect);
  for (const [w, h] of [[1920, 1080], [1440, 1080], [2520, 1080], [1080, 1920]]) {
    vp = chartViewport(w, h);
    const s = state(chart.judgeLineList[1], 1);
    // Rotate the child's unrotated pixel displacement (.1*viewportWidth, -.1*height) by 90 degrees.
    expect((s[1] - .5) * vp.width).toBeCloseTo(.1 * h);
    expect((s[2] - .5) * h).toBeCloseTo(.1 * vp.width);
    const hud = gameHudLayout(w, h, vp);
    const a = hudAttachment(chart.judgeLineList, 'pause', 1, (line, t) => {
      const st = state(line, t); return [st[0], (vp.left + st[1] * vp.width) / w, st[2], st[3]];
    }, hud.width, hud.height)!;
    expect(a.dx * hud.scale).toBeCloseTo(.1 * h);
    expect(a.dy * hud.scale).toBeCloseTo(.1 * vp.width);
  }
});

it('keeps pointer judgement and feedback aligned with note offsets inside a capped viewport', () => {
  const note: RuntimeNote = { type: 1, time: 1, sect: 1, secht: 0, holdTime: 0, hold_end_time: 1,
    positionX: 4, speed: 1, is_hold: false, is_above: true, clicked: false,
    master: { get_state: () => [0, .5, .5, 1], get_viewport: () => ({ width: 1000, gameplayScale: .5 }) } };
  const judge = new Judge();
  judge.reset([note]); judge.input('pointer', 1450, 400, 'tap', 1, 2000, 800, false);
  expect(judge.stats.perfect).toBe(0);
  judge.reset([note]); judge.input('pointer', 1225, 400, 'tap', 1, 2000, 800, false);
  expect(judge.stats.perfect).toBe(1);
  expect(hitEffectPosition(createHitEffect(note, 1, 'perfect'), 2000, 800)).toEqual([1225, 400]);
});

it('uses the saved width-ratio override ahead of chart metadata, with zero restoring automatic mode', () => {
  expect(resolveChartAspect(1.5, 4 / 3)).toBe(4 / 3);
  expect(resolveChartAspect(1.5, 0)).toBe(1.5);
  expect(resolveChartAspect(undefined, 0)).toBe(16 / 9);
  expect(resolveChartAspect(1.5, NaN)).toBe(1.5);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let saved = '{}';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; },
  } });
  try {
    expect(loadSettings().chartAspectRatio).toBe(0);
    saveSettings({ ...defaults, chartAspectRatio: 1.5 });
    expect(loadSettings().chartAspectRatio).toBe(1.5);
    saved = JSON.stringify({ chartAspectRatio: -1 }); expect(loadSettings().chartAspectRatio).toBe(0);
    saved = JSON.stringify({ chartAspectRatio: 99 }); expect(loadSettings().chartAspectRatio).toBe(4);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete (globalThis as any).localStorage;
  }
});
