import { describe, expect, it } from 'vitest';
import { avatarId, parseTips } from '../../src/core/profile-assets';

describe('profile assets and loading tips', () => {
  it('keeps saved avatars working after moving to the complete avatar library', () => {
    expect(avatarId('violet')).toBe('OblivionPHIN');
    expect(avatarId('gino')).toBe('ShineAfter_鸠_普通1');
    expect(avatarId('瓷岁特典')).toBe('瓷岁特典');
  });
  it('loads UTF-8 BOM / Windows lines without treating tips as markup', () => {
    expect(parseTips('\uFEFF第一条\r\n\r\n <Tip>原文</Tip> \n')).toEqual(['第一条', '<Tip>原文</Tip>']);
  });
});
