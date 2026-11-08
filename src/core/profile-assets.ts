export interface AvatarEntry { id: string; name: string; file: string; }

const previousIds: Record<string, string> = {
  violet: 'OblivionPHIN', gino: 'ShineAfter_鸠_普通1', cyan: '青芽', gold: '华灯爱1', mono: '瓷岁1',
};

export function avatarId(value: string): string { return previousIds[value] || value; }

export function parseTips(text: string): string[] {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}
