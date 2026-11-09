import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fakeSyncFrame } from '../../../src/ui/results/sync';
import { unityKeyValue } from '../../../src/ui/scenes/scene';

const data = JSON.parse(readFileSync(new URL('../../../assets/ui/scenes.json', import.meta.url), 'utf8'));
const timing = {
  delay: data.scenes.result.bindings.AutoSyncControl.animOffset,
  show: data.clips.SyncShow.duration, loop: data.clips.Sync.duration, success: data.clips.SyncSuccess.duration,
};
const completed = timing.delay + .5 + timing.loop;

describe('original result sync animation with a local fake response', () => {
  it('waits for animOffset, expands, then runs a complete original indicator cycle', () => {
    expect(fakeSyncFrame(1.999, timing).phase).toBe('waiting');
    expect(fakeSyncFrame(2, timing)).toMatchObject({ phase: 'syncing', clip: 'SyncShow', time: 0, loopTime: null });
    expect(fakeSyncFrame(2.499, timing).loopTime).toBeNull();
    expect(fakeSyncFrame(2.5, timing).loopTime).toBe(0);
    expect(fakeSyncFrame(completed - .001, timing).phase).toBe('syncing');
  });

  it('plays the exported success flash and collapse, then hides and starts fresh on a new result', () => {
    expect(fakeSyncFrame(completed, timing)).toMatchObject({ phase: 'success', clip: 'SyncSuccess', time: 0 });
    expect(fakeSyncFrame(completed + 1.6, timing).time).toBeCloseTo(1.6);
    expect(fakeSyncFrame(completed + timing.success, timing).phase).toBe('hidden');
    expect(fakeSyncFrame(0, timing).phase).toBe('waiting');
  });

  it('retains staggered indicator alpha and success RGB curves, rather than only changing a label', () => {
    const indicator = data.clips.Sync.tracks.map(track => unityKeyValue(track.keys, .25));
    expect(indicator[0]).toBeCloseTo(.32279637);
    expect(indicator[1]).toBeCloseTo(.56422377);
    expect(indicator[2]).toBeCloseTo(.80829054);
    const red = data.clips.SyncSuccess.tracks.find(track => track.attribute === 'm_Color.r');
    expect(unityKeyValue(red.keys, 0)).toBe(1);
    expect(unityKeyValue(red.keys, .25)).toBeCloseTo(.1690228);
    expect(unityKeyValue(red.keys, 2 / 3)).toBeCloseTo(0);
  });
});
