export const resultMusicFiles = ['ez', 'hd', 'in', 'at'].map(level => `/assets/audio/result/${level}.ogg`);

// LevelOverControl.SetResultAudio @ RVA 0x1d80698: unknown difficulties use IN.
export function resultMusicFile(level: string): string {
  const difficulty = level.match(/^(EZ|HD|IN|AT)\b/i)?.[1].toLowerCase() || 'in';
  return `/assets/audio/result/${difficulty}.ogg`;
}
