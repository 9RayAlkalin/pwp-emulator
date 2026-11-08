import type { Settings } from './types';
import { avatarId } from './core/profile-assets';

export const defaults: Settings = {
  autoplay: true, speed: 1, offset: 0, volume: 0.7, hitVolume: 0.6,
  brightness: 0.65, noteScale: 1, effects: true, apFcIndicator: true, fullscreen: false,
  chartAspectRatio: 0,
  playerName: '9RayAlkalin', playerId: '00000000', playerAvatar: 'OblivionPHIN', playerRks: 16.08, playerChallengeModeRank: 48,
  playerChallengeModeTier: 3, playerShowName: true,
  skipLoadingAnimation: false,
  collectionDisplay: 'auto', collectionType: 'data', collectionAmount: 1, collectionName: '',
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
    result.chartAspectRatio = Math.min(4, Math.max(0, result.chartAspectRatio));
    result.playerName = result.playerName.trim().slice(0, 20) || defaults.playerName;
    result.playerId = result.playerId.replace(/\D/g, '').slice(0, 12).padStart(8, '0');
    result.playerRks = Math.min(20, Math.max(0, result.playerRks));
    result.playerAvatar = avatarId(result.playerAvatar);
    result.playerChallengeModeRank = Math.round(Math.min(99, Math.max(0, result.playerChallengeModeRank)));
    result.playerChallengeModeTier = Math.round(Math.min(5, Math.max(0, result.playerChallengeModeTier)));
    if (!['auto', 'always', 'never'].includes(result.collectionDisplay)) result.collectionDisplay = defaults.collectionDisplay;
    if (!['data', 'avatar', 'illustration', 'file'].includes(result.collectionType)) result.collectionType = defaults.collectionType;
    result.collectionAmount = Math.min(1000000, Math.max(0, result.collectionAmount));
    result.collectionName = result.collectionName.trim().slice(0, 12);
    return result;
  } catch { return { ...defaults }; }
}
export function saveSettings(settings: Settings): void {
  try { localStorage.setItem('pwp.settings', JSON.stringify(settings)); } catch { /* Private browsing / quota. */ }
}
