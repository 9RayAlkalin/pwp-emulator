import { describe, expect, it } from 'vitest';
import { entrancePhase } from '../../src/core/play-entrance';

describe('start button scene flow', () => {
  it('prepares resources without drawing until start is pressed', () => {
    expect(entrancePhase(null, 100, false, 1)).toBe('ready');
    expect(entrancePhase(null, 100, true, 1)).toBe('ready');
  });

  it('shows loading for 1.5 seconds before the exported transition', () => {
    expect(entrancePhase(10, 10, false, 1)).toBe('loading');
    expect(entrancePhase(10, 11.499, false, 1)).toBe('loading');
    expect(entrancePhase(10, 11.5, false, 1)).toBe('enter');
    expect(entrancePhase(10, 12.499, false, 1)).toBe('enter');
    expect(entrancePhase(10, 12.5, false, 1)).toBe('opening');
    expect(entrancePhase(10, 13.999, false, 1)).toBe('opening');
    expect(entrancePhase(10, 14, false, 1)).toBe('game');
  });

  it('starts directly in gameplay when the animation is skipped', () => {
    expect(entrancePhase(10, 10, true, 1)).toBe('game');
  });
});
