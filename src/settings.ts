import type { Settings } from './types';

export const defaults: Settings = {
  autoplay: true, speed: 1, offset: 0, volume: 0.7, hitVolume: 0.6,
  brightness: 0.65, noteScale: 1, effects: true, fullscreen: false,
};
export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem('pwp.settings') || '{}');
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof Settings)[]) {
      if (typeof saved[key] === typeof defaults[key] && (typeof saved[key] !== 'number' || Number.isFinite(saved[key]))) Object.assign(result, { [key]: saved[key] });
    }
    result.speed = Math.min(2, Math.max(0.5, result.speed));
    result.offset = Math.min(500, Math.max(-500, result.offset));
    for (const key of ['volume', 'hitVolume', 'brightness'] as const) result[key] = Math.min(1, Math.max(0, result[key]));
    result.noteScale = Math.min(1.5, Math.max(0.5, result.noteScale));
    return result;
  } catch { return { ...defaults }; }
}
export function saveSettings(settings: Settings): void {
  try { localStorage.setItem('pwp.settings', JSON.stringify(settings)); } catch { /* Private browsing / quota. */ }
}
