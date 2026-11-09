export interface SyncTiming { delay: number; show: number; loop: number; success: number; }
export interface SyncFrame {
  phase: 'waiting' | 'syncing' | 'success' | 'hidden';
  clip: 'SyncHide' | 'SyncShow' | 'SyncSuccess';
  time: number;
  loopTime: number | null;
}

// AutoSyncControl.Sync waits 500 ms before requesting the result (RVA 0x1d70000).
export const syncRequestDelay = .5;

export function fakeSyncFrame(elapsed: number, timing: SyncTiming): SyncFrame {
  const time = elapsed - timing.delay;
  if (time < 0) return { phase: 'waiting', clip: 'SyncHide', time: 0, loopTime: null };
  // A local fake response takes one original indicator cycle, with no cloud request.
  const completed = timing.delay + syncRequestDelay + timing.loop;
  if (elapsed < completed) return {
    phase: 'syncing', clip: 'SyncShow', time: Math.min(time, timing.show),
    loopTime: time < syncRequestDelay ? null : (time - syncRequestDelay) % timing.loop,
  };
  if (elapsed < completed + timing.success) return {
    phase: 'success', clip: 'SyncSuccess', time: elapsed - completed, loopTime: null,
  };
  return { phase: 'hidden', clip: 'SyncHide', time: 0, loopTime: null };
}
