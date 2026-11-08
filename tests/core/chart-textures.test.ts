import { expect, it } from 'vitest';
import { textureFrame } from '../../src/core/chart-textures';

const frames = { duration: .6, frames: [{ image: {} as CanvasImageSource, end: .1 }, { image: {} as CanvasImageSource, end: .6 }] };
it('selects GIF frames by duration and rewinds deterministically, including negative time', () => {
  expect(textureFrame(frames, 0)).toBe(0);
  expect(textureFrame(frames, .2)).toBe(1);
  expect(textureFrame(frames, .65)).toBe(0);
  expect(textureFrame(frames, .05)).toBe(0);
  expect(textureFrame(frames, -.2)).toBe(1);
});
it('addresses the first and last GIF frames by explicit progress, looping outside the unit interval', () => {
  expect(textureFrame(frames, 100, 0)).toBe(0);
  expect(textureFrame(frames, 100, 1)).toBe(1);
  expect(textureFrame(frames, 0, 1.25)).toBe(0);
  expect(textureFrame(frames, 0, -.25)).toBe(1);
});
