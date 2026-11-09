import { describe, expect, it } from 'vitest';
import { exportFrame, exportTimeline } from '../../../src/render/video/timeline';
import { resultMusicFile } from '../../../src/ui/results/music';

describe('offline scene timeline', () => {
  it('retains the gameplay entrance from zero while a plain excerpt starts immediately', () => {
    const full = exportTimeline(0, 10, {}, 1);
    expect(full.musicStart).toBe(1.5);
    expect(exportFrame(full, 1.499).scene).toBe('game-opening');
    expect(exportFrame(full, 1.5)).toEqual({ scene: 'game', elapsed: 0, musicTime: 0 });
    const excerpt = exportTimeline(5, 10, {}, 1);
    expect(excerpt.duration).toBe(5);
    expect(exportFrame(excerpt, 0)).toEqual({ scene: 'game', elapsed: 0, musicTime: 5 });
  });

  it('adds loading, its slide out, gameplay entrance and correctly delayed music', () => {
    const plan = exportTimeline(5, 10, { loading: true }, 1);
    expect(plan.musicStart).toBe(4);
    expect(plan.duration).toBe(9);
    expect(exportFrame(plan, 1.499).scene).toBe('loading');
    expect(exportFrame(plan, 1.5)).toEqual({ scene: 'loading-exit', elapsed: 0, musicTime: 5 });
    expect(exportFrame(plan, 2.5)).toEqual({ scene: 'game-opening', elapsed: 0, musicTime: 5 });
    expect(exportFrame(plan, 4)).toEqual({ scene: 'game', elapsed: 0, musicTime: 5 });
    expect(exportFrame(plan, 6).musicTime).toBe(7);
  });

  it('keeps the end delay, HUD exit, result entrance and sync on one deterministic clock', () => {
    const plan = exportTimeline(5, 10, { result: true }, 1);
    expect(plan.resultStart).toBeCloseTo(8.7);
    expect(plan.duration).toBeCloseTo(15.7);
    expect(exportFrame(plan, 5.199).scene).toBe('game');
    expect(exportFrame(plan, 5.2)).toEqual({ scene: 'game-over', elapsed: 0, musicTime: 10.2 });
    expect(exportFrame(plan, plan.resultStart)).toEqual({ scene: 'result', elapsed: 0, musicTime: 10.2 });
    expect(exportFrame(plan, plan.resultStart + 6).elapsed).toBeCloseTo(6);
    expect(exportTimeline(0, 10, { loading: true, result: true, resultSeconds: 9 }, 1).duration).toBeCloseTo(26.7);
  });

  it('selects the original difficulty music and its native IN fallback', () => {
    for (const level of ['EZ', 'HD', 'IN', 'AT']) expect(resultMusicFile(`${level} Lv.14`)).toBe(`/assets/audio/result/${level.toLowerCase()}.ogg`);
    expect(resultMusicFile('SP Lv.?')).toBe('/assets/audio/result/in.ogg');
  });

  it('freezes chart playback position for every opening frame before releasing music and chart together', () => {
    const plan=exportTimeline(12,20,{loading:true},1);
    for(const elapsed of [0,.25,.75,1.05,1.499999]) {
      const frame=exportFrame(plan,2.5+elapsed);
      expect(frame.scene).toBe('game-opening');expect(frame.musicTime).toBe(12);
    }
    expect(exportFrame(plan,4)).toEqual({scene:'game',elapsed:0,musicTime:12});
  });
});
