import { describe, expect, it } from 'vitest';
import { collectionReward, collectionVisible } from '../../src/core/result-collection';
import { defaults, loadSettings } from '../../src/settings';

describe('custom local result collections', () => {
  it('selects the four original icon slots and custom reward text', () => {
    expect(collectionReward({ ...defaults, collectionAmount: 12.34 })).toEqual({ index: 0, text: '12.34 MB' });
    for (const [index, collectionType] of ['data', 'avatar', 'illustration', 'file'].entries()) {
      const reward = collectionReward({ ...defaults, collectionType: collectionType as typeof defaults.collectionType, collectionName: '自定义收藏' });
      expect(reward.index).toBe(index);
      if (index) expect(reward.text).toBe('自定义收藏');
    }
    expect(collectionReward({ ...defaults, collectionType: 'avatar' }).text).toBe('头像');
  });

  it('keeps the original display delay and supports auto, always and hidden rewards', () => {
    expect(collectionVisible(defaults, false, 6)).toBe(false);
    expect(collectionVisible(defaults, true, 6)).toBe(true);
    expect(collectionVisible({ ...defaults, collectionDisplay: 'always' }, false, 1.999)).toBe(false);
    expect(collectionVisible({ ...defaults, collectionDisplay: 'always' }, false, 2)).toBe(true);
    expect(collectionVisible({ ...defaults, collectionDisplay: 'never' }, true, 6)).toBe(false);
  });

  it('loads new defaults alongside legacy saved settings and rejects invalid options', () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    try {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => JSON.stringify({ playerName: '旧档案', collectionType: 'unknown', collectionDisplay: 'unknown', collectionAmount: -5 }) } });
      expect(loadSettings()).toMatchObject({ playerName: '旧档案', collectionType: 'data', collectionDisplay: 'auto', collectionAmount: 0, collectionName: '' });
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});
