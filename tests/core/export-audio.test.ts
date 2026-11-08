import { describe, expect, it } from 'vitest';
import { audioWav } from '../../src/core/export/audio';

describe('FFmpeg PCM input', () => {
  it('writes a stereo WAV with clipped, interleaved signed 16-bit samples', () => {
    const planes = [new Float32Array([-2, -.5, 0, 2]), new Float32Array([1, .5, 0, -1])];
    const wav = audioWav({ numberOfChannels: 2, length: 4, sampleRate: 48000, getChannelData: (channel: number) => planes[channel] } as AudioBuffer);
    const view = new DataView(wav.buffer), text = (start: number, length: number) => new TextDecoder().decode(wav.slice(start, start + length));
    expect(text(0, 4)).toBe('RIFF'); expect(text(8, 4)).toBe('WAVE'); expect(text(36, 4)).toBe('data');
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint32(40, true)).toBe(16);
    expect(view.getUint32(24, true)).toBe(48000); expect(view.getUint32(28, true)).toBe(192000);
    expect(view.getUint16(22, true)).toBe(2); expect(view.getUint16(34, true)).toBe(16);
    expect(Array.from({ length: 8 }, (_, index) => view.getInt16(44 + index * 2, true))).toEqual([-32768, 32767, -16384, 16384, 0, 0, 32767, -32768]);
  });
});
