import { describe, expect, it } from 'vitest';
import { encodingOptions, muxArguments, videoArguments } from '../../src/core/export/options';

describe('codec and container compatibility', () => {
  it('rejects incompatible containers, bit depths and audio before loading Wasm', () => {
    expect(() => encodingOptions({ codec: 'hevc', container: 'webm' })).toThrow('容器');
    expect(() => encodingOptions({ codec: 'vp9', container: 'webm', pixelFormat: 'yuv420p10le' })).toThrow('像素格式');
    expect(() => encodingOptions({ container: 'mp4', audioCodec: 'flac' })).toThrow('音频编码');
  });
  it('produces HEVC 10-bit and uses the MP4 hvc1 tag in both encoding and remuxing', () => {
    const options = encodingOptions({ codec: 'hevc', pixelFormat: 'yuv420p10le', preset: 'fast', crf: 24 });
    const args = videoArguments(options, 60, 8000000);
    expect(args).toContain('libx265'); expect(args).toContain('yuv420p10le'); expect(args).toContain('hvc1');
    expect(args).toContain('-crf'); expect(args).toContain('24'); expect(args).not.toContain('-b:v');
    expect(muxArguments(options, true, 3, 'out.mp4')).toContain('hvc1');
  });
  it('uses VP9 with Opus for WebM and omits CRF in target bitrate mode', () => {
    const options = encodingOptions({ codec: 'vp9', container: 'webm', rateControl: 'bitrate' });
    expect(videoArguments(options, 30, 5000000)).toContain('5000000');
    expect(videoArguments(options, 30, 5000000)).not.toContain('-crf');
    expect(muxArguments(options, true, 3, 'out.webm')).toContain('libopus');
  });
  it('keeps FFV1 lossless RGB and lossless audio without bitrate or CRF overrides', () => {
    const options = encodingOptions({ codec: 'ffv1', container: 'mkv', pixelFormat: 'bgr0', audioCodec: 'flac' });
    const args = videoArguments(options, 30, 5000000);
    expect(args).toContain('ffv1'); expect(args).toContain('bgr0');
    expect(args).not.toContain('-crf'); expect(args).not.toContain('-b:v');
    expect(muxArguments(options, true, 3, 'out.mkv')).toContain('flac');
  });
});
