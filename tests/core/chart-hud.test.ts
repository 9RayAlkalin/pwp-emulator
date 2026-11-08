import { expect, it } from 'vitest';
import { hudAttachment, inverseHudPoint } from '../../src/core/chart-hud';
import { parseChart } from '../../src/library/importer';
import { createLineStateResolver } from '../../src/core/chart-state';

const b = (n: number) => [n, 0, 1];
const e = (n: number) => ({ startTime: b(0), endTime: b(10), start: n, end: n });
it('applies attachment translation from the line origin and uses the last binding for duplicate targets', () => {
  const chart = parseChart({ META: {}, BPMList: [{ startTime: b(0), bpm: 120 }], judgeLineList: [
    { attachUI: 'pause', eventLayers: [{ alphaEvents: [e(255)] }] },
    { attachUI: 'pause', eventLayers: [{ moveXEvents: [e(135)], moveYEvents: [e(90)], rotateEvents: [e(90)], alphaEvents: [e(128)] }],
      extended: { scaleXEvents: [e(2)], scaleYEvents: [e(.5)] } },
  ] });
  const state = createLineStateResolver(chart.judgeLineList);
  const attachment = hudAttachment(chart.judgeLineList, 'pause', 1, state, 1000, 600)!;
  expect(attachment.dx).toBeCloseTo(100); expect(attachment.dy).toBeCloseTo(-60);
  expect(attachment).toMatchObject({ rotation: 90, scaleX: 2, scaleY: .5 });
  expect(attachment.alpha).toBeCloseTo(128 / 255);
  expect(hudAttachment(chart.judgeLineList, 'name', 1, state, 1000, 600)).toBeUndefined();
});
it('maps a moved, rotated, stretched pause hitbox back into its local coordinates and rejects invisible controls', () => {
  const a = { dx: 50, dy: 70, rotation: 90, scaleX: 2, scaleY: .5, alpha: 1 };
  // Local (12,24), pivot (10,20) -> scale (4,2), rotate (-2,4), then translate.
  const point = inverseHudPoint(58, 94, a, 10, 20)!;
  expect(point[0]).toBeCloseTo(12); expect(point[1]).toBeCloseTo(24);
  expect(inverseHudPoint(1, 2, { ...a, alpha: 0 }, 0, 0)).toBeUndefined();
  expect(inverseHudPoint(1, 2, { ...a, scaleX: 0 }, 0, 0)).toBeUndefined();
  expect(inverseHudPoint(1, 2, undefined, 0, 0)).toEqual([1, 2]);
});
