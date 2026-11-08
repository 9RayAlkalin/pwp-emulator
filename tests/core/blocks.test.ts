import { describe, expect, it } from 'vitest';
import { blockingBlockAt, block_state, block_transform, BlockTouchFeedback } from '../../src/core/blocks';

const block = (extra = {}) => ({
  appearTime: 0, enableTime: 1, disableTime: 3, disappearTime: 4, isSubtract: false,
  bottomLeftPercentage: { x: 0.2, y: 0.2 }, topRightPercentage: { x: 0.8, y: 0.8 },
  moveEvents: [], scaleEvents: [], rotateEvents: [], ...extra,
});
const hit = (blocks: any[], x = 500, y = 250, t = 2) => blockingBlockAt(blocks, t, x, y, 1000, 500);

describe('native block touch geometry', () => {
  it('shows Disabled before the final half-second Ready phase and does not fade out after disable', () => {
    const b = block();
    expect(block_state(b, -0.1)).toBeNull();
    expect(block_state(b, 0.25)).toEqual({ phase: 2, alpha: 0.5 });
    expect(block_state(b, 0.5)).toEqual({ phase: 0, alpha: 1 });
    expect(block_state(b, 1)).toEqual({ phase: 1, alpha: 1 });
    expect(block_state(b, 3.9)).toEqual({ phase: 2, alpha: 1 });
    expect(block_state(b, 4)).toBeNull();
    expect(block_state(b, 0.25, 2)).toEqual({ phase: 2, alpha: 0.25 });
  });
  it('only blocks during [enableTime, disableTime)', () => {
    const b = block();
    expect(hit([b], 500, 250, 0.99)).toBeNull();
    expect(hit([b], 500, 250, 1)).toBe(b);
    expect(hit([b], 500, 250, 3)).toBeNull();
  });
  it('insets normal blocks by 5% of screen height on both axes', () => {
    const b = block();
    expect(hit([b], 224)).toBeNull();
    expect(hit([b], 225)).toBe(b);
    expect(hit([b], 500, 124)).toBeNull();
    expect(hit([b], 500, 125)).toBe(b);
    expect(blockingBlockAt([b], 2, 450, 250, 2000, 500)).toBe(b);
  });
  it('expands subtract holes and keeps the raw coverage gate', () => {
    const normal = block();
    const hole = block({ isSubtract: true, bottomLeftPercentage: { x: 0.4, y: 0.4 }, topRightPercentage: { x: 0.6, y: 0.6 } });
    expect(hit([normal, hole])).toBeNull();
    expect(hit([normal, hole], 624.9)).toBeNull();
    expect(hit([normal, hole], 626)).toBe(normal);
    // Native uses OR of normal blocks XOR parity of subtract blocks, not set subtraction.
    expect(hit([normal, hole, { ...hole }])).toBe(normal);
    expect(hit([hole])).toBe(hole);
    expect(hit([hole], 610)).toBeNull();
    expect(hit([normal, { ...normal }])).toBe(normal);
  });
  it('uses the same rotated and animated geometry as the renderer', () => {
    const b = block({ bottomLeftPercentage: { x: 0.2, y: 0.3 }, topRightPercentage: { x: 0.8, y: 0.7 },
      rotateEvents: [{ time: 0, rotation: 90, anchor: { x: 0.5, y: 0.5 } }] });
    expect(hit([b], 500, 100)).toBe(b);
    expect(hit([b], 600, 250)).toBeNull();
    const moving = block({ enableTime: 0, moveEvents: [{ time: 0, endPosition: { x: 0.2, y: 0.5 } }, { time: 2, endPosition: { x: 0.8, y: 0.5 } }],
      scaleEvents: [{ time: 0, scale: { x: 0.5, y: 0.5 } }] });
    expect(block_transform(moving, 0, 1000, 500).cx_px).toBeCloseTo(200);
    expect(block_transform(moving, 1, 1000, 500).cx_px).toBeCloseTo(500);
    expect(hit([moving], 500, 250, 0)).toBeNull();
    expect(hit([moving], 500, 250, 1)).toBe(moving);
    expect(hit([block({ scaleEvents: [{ time: 0, scale: { x: 0, y: 1 } }] })])).toBeNull();
  });
});

describe('touch hover lifecycle', () => {
  it('grows in 0.1 real seconds, follows its finger, then shrinks from its current scale', () => {
    const fx = new BlockTouchFeedback();
    fx.update([{ id: 'a', x: 100, y: 200 }], 0);
    fx.update([{ id: 'a', x: 120, y: 210 }], 0.05);
    expect(fx.visible[0]).toMatchObject({ x: 120, y: 210, active: true });
    expect(fx.visible[0].scale).toBeCloseTo(0.5);
    fx.update([], 0.05);
    fx.update([], 0.1);
    expect(fx.visible[0].scale).toBeCloseTo(0.25);
    fx.update([], 0.16);
    expect(fx.visible).toHaveLength(0);
  });
  it('caps feedback at ten touches and can reuse released slots', () => {
    const fx = new BlockTouchFeedback();
    const touches = Array.from({ length: 11 }, (_, i) => ({ id: String(i), x: i, y: i }));
    fx.update(touches, 0); fx.update(touches, 0.2);
    expect(fx.visible).toHaveLength(10);
    fx.update(touches.slice(1), 0.21);
    expect(fx.visible).toHaveLength(10);
    expect(fx.visible.some(touch => touch.id === '10' && touch.active)).toBe(true);
    fx.clear(); expect(fx.visible).toHaveLength(0);
  });
});
