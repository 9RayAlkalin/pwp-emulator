import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { unityKeyValue } from '../../../src/ui/scenes/scene';
import { resultGrade, resultRecordKey } from '../../../src/ui/results/records';
import { shadowBlurConfig } from '../../../src/render/blur';
import type { Statistics } from '../../../src/gameplay/types';

const data = JSON.parse(readFileSync(new URL('../../../assets/ui/scenes.json', import.meta.url), 'utf8'));

describe('original Unity scene data', () => {
  it('retains the result hierarchy and its actual 3.5 second entrance clip', () => {
    expect(data.clips.LevelOvarAnimation.duration).toBe(3.5);
    expect(data.clips.LevelOver.duration).toBeCloseTo(2 / 3, 5);
    expect(data.scenes.result.nodes['52'].sizeDelta).toEqual({ x: 1000, y: 624 });
    expect(data.scenes.result.nodes['52'].path).toBe('Canvas/Canvas/content/Cover');
    expect(data.scenes.intro.nodes['157'].sizeDelta).toEqual({ x: 975.6135, y: 514.48364 });
    const slider = Object.values(data.scenes.result.nodes).find((node: any) => node.transformId === data.scenes.result.bindings.PlayerBarControl.playerIdSlider.fileID) as any;
    expect(slider.path).toBe('Canvas/Canvas (1)/PlayerBar/Slider/Image');
  });

  it('evaluates the original Hermite tangents between keys', () => {
    const keys = [{ time: 0, value: 0, inSlope: 0, outSlope: 0 }, { time: 1, value: 1, inSlope: 0, outSlope: 0 }];
    expect(unityKeyValue(keys, .25)).toBeCloseTo(.15625);
    expect(unityKeyValue(keys, -1)).toBe(0);
    expect(unityKeyValue(keys, 2)).toBe(1);
    expect(unityKeyValue([{ ...keys[0], outSlope: 'Infinity' }, keys[1]], .9)).toBe(0);
  });

  it('uses the native TrueShadow size-to-radius conversion', () => {
    expect(shadowBlurConfig(0)).toEqual({ radius: 0, iteration: 0 });
    expect(shadowBlurConfig(20).iteration).toBe(3);
    expect(shadowBlurConfig(20).radius).toBeCloseTo(1.551915, 5);
  });

  it('reproduces pause backdrop and result slide keyframes', () => {
    const pause = data.clips.Pause.tracks.find(t => t.path === 'Translucent Image (1)' && t.attribute === 'm_Color.a');
    expect(unityKeyValue(pause.keys, .05)).toBeCloseTo(.46590355);
    const result = data.clips.LevelOvarAnimation.tracks.find(t => t.path === 'Canvas/content' && t.attribute === 'm_AnchoredPosition.x');
    expect(unityKeyValue(result.keys, 0)).toBe(2500);
    expect(unityKeyValue(result.keys, 3.5)).toBe(0);
  });

  it('selects score ratings at their native thresholds without granting an empty FC', () => {
    const stats = { total: 595, perfect: 0, good: 0, bad: 0, miss: 595, score: 0 } as Statistics;
    for (const [score, grade] of [[0, 'F'], [699999, 'F'], [700000, 'C'], [820000, 'B'], [880000, 'A'], [920000, 'S'], [960000, 'V'], [1000000, 'Phi']] as const) expect(resultGrade({ ...stats, score })).toBe(grade);
    expect(resultGrade({ ...stats, perfect: 500, good: 95, miss: 0, score: 944117 })).toBe('FC');
    expect(resultGrade({ ...stats, total: 0, miss: 0 })).toBe('F');
  });

  it('stores result records by resource path rather than development origin', () => {
    expect(resultRecordKey('http://127.0.0.1:5173/assets/library/song/IN')).toBe('/assets/library/song/IN');
    expect(resultRecordKey('https://example.test/PhigrosWebPlayer/assets/library/song/IN')).toBe('/assets/library/song/IN');
    expect(resultRecordKey('/assets/library/song/IN/')).toBe('/assets/library/song/IN');
    expect(resultRecordKey('/res/library/song/IN')).toBe('/assets/library/song/IN');
    expect(resultRecordKey('http://127.0.0.1:5173/res/s6')).toBe('/assets/builtin/s6');
  });
});
