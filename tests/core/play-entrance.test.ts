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

  it('skips loading while retaining the gameplay entrance and audio delay', () => {
    expect(entrancePhase(10, 10, true, 1)).toBe('opening');
    expect(entrancePhase(10, 11.499, true, 1)).toBe('opening');
    expect(entrancePhase(10, 11.5, true, 1)).toBe('game');
    expect(entrancePhase(10, 11.5, true, 20)).toBe('game');
  });

  it('holds gameplay until the full opening boundary even when loading was skipped', () => {
    for (const time of [0, .1, .5, 1.05, 1.083334, 1.499999]) {
      expect(entrancePhase(0,time,true,1)).toBe('opening');
    }
    expect(entrancePhase(0,1.5,true,1)).toBe('game');
    expect(entrancePhase(0,3.999999,false,1)).toBe('opening');
    expect(entrancePhase(0,4,false,1)).toBe('game');
  });
});
