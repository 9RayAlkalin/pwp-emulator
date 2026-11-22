import { expect, it, vi } from 'vitest';
import { Spectrum, spectrumCadence } from '../../src/audio/spectrum';

const nativeNoise = (8192 * Math.fround(1e-8) * 2.5) ** 2 / 4096;

it('uses the native 2.5 amplitude gain for a bin-centred sine and supports backward seeks', () => {
  const amplitude = .4;
  const samples = Float32Array.from({ length: 16384 }, (_, i) => amplitude * Math.sin(2 * Math.PI * 32 * i / 8192));
  const audio = { sampleRate: 8192, getChannelData: () => samples } as unknown as AudioBuffer;
  const spectrum = new Spectrum(audio);
  // A real sine has magnitude A/2 at its positive-frequency bin.
  const expected = (amplitude / 2 * 2.5) ** 2 / 4096 + nativeNoise;
  expect(spectrum.meanSquare(0)).toBeCloseTo(nativeNoise, 15);
  expect(spectrum.meanSquare(1)).toBeCloseTo(expected, 10);
  expect(spectrum.meanSquare(1)).toBe(spectrum.meanSquare(1));
  expect(spectrum.meanSquare(10)).toBeCloseTo(nativeNoise, 15);
  expect(spectrum.meanSquare(1)).toBeCloseTo(expected, 10);
});

it('clamps each magnitude before the native squared average', () => {
  const samples = Float32Array.from({ length: 8192 }, (_, i) => Math.sin(2 * Math.PI * 32 * i / 8192));
  const audio = { sampleRate: 8192, getChannelData: () => samples } as unknown as AudioBuffer;
  expect(new Spectrum(audio).meanSquare(1)).toBeCloseTo(1 / 4096 + nativeNoise, 10);
});

it('leaves the highest output bin empty as in the native 4096-bin loop', () => {
  const samples = Float32Array.from({ length: 8192 }, (_, i) => .4 * Math.sin(2 * Math.PI * 4095 * i / 8192));
  const audio = { sampleRate: 8192, getChannelData: () => samples } as unknown as AudioBuffer;
  expect(new Spectrum(audio).meanSquare(1)).toBeCloseTo(nativeNoise, 12);
});

it('holds a 30 Hz spectrum for four 120 FPS frames and snaps seeks to the same ticks', () => {
  const sampleRate = 44100;
  const samples = Float32Array.from({ length: sampleRate * 2 }, (_, i) => (i / sampleRate) * .1);
  const getChannelData = vi.fn(() => samples);
  const audio = { sampleRate, getChannelData } as unknown as AudioBuffer;
  const spectrum = new Spectrum(audio, 30);
  const frames = Array.from({ length: 8 }, (_, i) => spectrum.meanSquare(1 + i / 120));
  expect(frames.slice(0, 4)).toEqual(Array(4).fill(frames[0]));
  expect(frames.slice(4)).toEqual(Array(4).fill(frames[4]));
  expect(frames[0]).not.toBe(frames[4]);
  expect(getChannelData).toHaveBeenCalledTimes(2);
  expect(spectrum.meanSquare(1 + 3 / 120)).toBe(frames[0]);
  expect(spectrum.meanSquare(1 + 1 / 30 - 1e-13)).toBe(frames[4]);
});

it('only opts into fixed sampling when a Lua script requests it', () => {
  expect(spectrumCadence([{ source: 'function on_update(dt,state) return state.spectrum end' }])).toBeUndefined();
  expect(spectrumCadence([{ source: '-- pwp:spectrum-hz=30\r\n' }])).toBe(30);
  expect(spectrumCadence([{ source: '-- pwp:spectrum-hz=0' }, { source: '-- pwp:spectrum-hz=3000' }])).toBeUndefined();
});
