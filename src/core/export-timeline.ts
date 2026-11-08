import { gameplayEndingSeconds, gameplayOpeningSeconds, loadingDisplaySeconds } from './play-entrance';

export type ExportScene = 'loading' | 'loading-exit' | 'game-opening' | 'game' | 'game-over' | 'result';
export interface ExportScenes { loading?: boolean; result?: boolean; resultSeconds?: number; }
export interface ExportTimeline {
  start: number; end: number; loading: number; loadingExit: number; opening: number;
  musicStart: number; musicEnd: number; endingStart: number; resultStart: number;
  resultSeconds: number; duration: number;
}

export function exportTimeline(start: number, end: number, scenes: ExportScenes, loadingExit: number): ExportTimeline {
  const loading = scenes.loading ? loadingDisplaySeconds : 0;
  const exit = scenes.loading ? loadingExit : 0;
  const opening = scenes.loading || start === 0 ? gameplayOpeningSeconds : 0;
  const musicStart = loading + exit + opening;
  const musicEnd = musicStart + Math.max(0, end - start);
  const endingStart = musicEnd + (scenes.result ? .2 : 0);
  const resultStart = endingStart + (scenes.result ? gameplayEndingSeconds : 0);
  const resultSeconds = scenes.result ? Math.max(3.5, Math.min(60, Number(scenes.resultSeconds) || 7)) : 0;
  return { start, end, loading, loadingExit: exit, opening, musicStart, musicEnd, endingStart, resultStart, resultSeconds, duration: resultStart + resultSeconds };
}

export function exportFrame(timeline: ExportTimeline, time: number): { scene: ExportScene; elapsed: number; musicTime: number } {
  const t = Math.max(0, time), plan = timeline;
  if (t < plan.loading) return { scene: 'loading', elapsed: t, musicTime: plan.start };
  if (t < plan.loading + plan.loadingExit) return { scene: 'loading-exit', elapsed: t - plan.loading, musicTime: plan.start };
  if (t < plan.musicStart) return { scene: 'game-opening', elapsed: t - plan.loading - plan.loadingExit, musicTime: plan.start };
  if (t < plan.endingStart || !plan.resultSeconds) return { scene: 'game', elapsed: t - plan.musicStart, musicTime: plan.start + t - plan.musicStart };
  const musicTime = plan.end + .2;
  if (t < plan.resultStart) return { scene: 'game-over', elapsed: t - plan.endingStart, musicTime };
  return { scene: 'result', elapsed: t - plan.resultStart, musicTime };
}
