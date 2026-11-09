import type { Settings } from '../../app/settings';

const types = ['data', 'avatar', 'illustration', 'file'] as const;
const names = ['Data', '头像', '曲绘', '收藏品档案'];

export function collectionReward(settings: Settings): { index: number; text: string } {
  const index = Math.max(0, types.indexOf(settings.collectionType));
  const text = index === 0 ? `${Math.min(1000000, Math.max(0, settings.collectionAmount ?? 1)).toFixed(2)} MB`
    : settings.collectionName?.trim().slice(0, 12) || names[index];
  return { index, text };
}

export function collectionVisible(settings: Settings, earned: boolean, elapsed: number): boolean {
  return elapsed >= 2 && settings.collectionDisplay !== 'never' && (settings.collectionDisplay === 'always' || earned);
}
