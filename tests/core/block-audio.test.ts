import { describe, expect, it, vi } from 'vitest';
import { MusicLowPass } from '../../src/core/block-audio';

function audio() {
  const param = () => ({ value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
  const node = () => ({ gain: param(), connect: vi.fn(function (this: any, target) { return target; }), disconnect: vi.fn() });
  const dry = node(), wet = node(), source = node();
  const filter = { ...node(), frequency: param(), Q: { value: 0 }, type: '' };
  const context = { currentTime: 0, destination: {}, createBiquadFilter: () => filter,
    createGain: vi.fn().mockReturnValueOnce(dry).mockReturnValueOnce(wet), createMediaElementSource: vi.fn().mockReturnValueOnce(source).mockImplementation(() => node()) };
  return { context, filter, dry, wet, source, lowpass: new MusicLowPass(context as unknown as AudioContext) };
}

describe('block music lowpass', () => {
  it('starts bypassed with the native 1500Hz preset, then restores dry music after 0.1s', () => {
    const { context, filter, dry, wet, lowpass } = audio();
    expect(dry.gain.setValueAtTime).toHaveBeenLastCalledWith(1, 0);
    expect(wet.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0);
    lowpass.setBlocked(true);
    expect(filter.frequency.linearRampToValueAtTime).toHaveBeenLastCalledWith(1500, 0.1);
    context.currentTime = 1; lowpass.setBlocked(false);
    expect(filter.frequency.linearRampToValueAtTime).toHaveBeenLastCalledWith(22000, 1.1);
    expect(dry.gain.setValueAtTime).toHaveBeenLastCalledWith(1, 1.1);
    expect(wet.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 1.1);
  });
  it('reverses an unfinished release from its current cutoff and cancels the pending bypass', () => {
    const { context, filter, dry, lowpass } = audio();
    lowpass.setBlocked(true); context.currentTime = 1; lowpass.setBlocked(false);
    context.currentTime = 1.05; lowpass.setBlocked(true);
    expect(filter.frequency.setValueAtTime.mock.lastCall?.[0]).toBeCloseTo(11750);
    expect(filter.frequency.linearRampToValueAtTime.mock.lastCall?.[0]).toBe(1500);
    expect(filter.frequency.linearRampToValueAtTime.mock.lastCall?.[1]).toBeCloseTo(1.15);
    expect(dry.gain.cancelScheduledValues).toHaveBeenLastCalledWith(1.05);
    expect(dry.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 1.05);
  });
  it('reuses media source nodes and resets filter state on a chart change', () => {
    const { context, source, dry, lowpass } = audio();
    const one = {} as HTMLMediaElement, two = {} as HTMLMediaElement;
    lowpass.attach(one); lowpass.attach(one);
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
    lowpass.setBlocked(true); lowpass.attach(two);
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(2);
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(dry.gain.setValueAtTime).toHaveBeenLastCalledWith(1, 0);
  });
});
