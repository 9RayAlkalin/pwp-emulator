export type EntrancePhase = 'ready' | 'loading' | 'enter' | 'opening' | 'game';
export const loadingDisplaySeconds = 1.5;
// ProgressControl.Update RVA 0x1d885b8: first normal play schedules audio after 1.5 s.
export const gameplayOpeningSeconds = 1.5;
// ProgressControl.Update RVA 0x1d88a58: normal completion waits 3.5 s before capture.
export const gameplayEndingSeconds = 3.5;

export function entrancePhase(start: number | null, now: number, skip: boolean, transitionSeconds: number): EntrancePhase {
  if (start === null) return 'ready';
  if (skip) return 'game';
  const elapsed = Math.max(0, now - start);
  if (elapsed < loadingDisplaySeconds) return 'loading';
  if (elapsed < loadingDisplaySeconds + transitionSeconds) return 'enter';
  if (elapsed < loadingDisplaySeconds + transitionSeconds + gameplayOpeningSeconds) return 'opening';
  return 'game';
}
