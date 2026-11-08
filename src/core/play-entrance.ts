export type EntrancePhase = 'ready' | 'loading' | 'enter' | 'opening' | 'game';
export const loadingDisplaySeconds = 1.5;
// Playback stays frozen for the full gameplay opening, including the original
// 1.0833 s Began curve and the HUD entrance. Live playback/export share this gate.
export const gameplayOpeningSeconds = 1.5;
// ProgressControl.Update RVA 0x1d88a58: normal completion waits 3.5 s before capture.
export const gameplayEndingSeconds = 3.5;

export function entrancePhase(start: number | null, now: number, skip: boolean, transitionSeconds: number): EntrancePhase {
  if (start === null) return 'ready';
  const elapsed = Math.max(0, now - start);
  if (!skip && elapsed < loadingDisplaySeconds) return 'loading';
  const openingStart = skip ? 0 : loadingDisplaySeconds + transitionSeconds;
  if (elapsed < openingStart) return 'enter';
  if (elapsed < openingStart + gameplayOpeningSeconds) return 'opening';
  return 'game';
}
