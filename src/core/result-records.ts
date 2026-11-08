import type { Statistics } from '../types';

export function resultGrade(stats: Statistics): string {
  if (stats.score >= 1000000) return 'Phi';
  if (stats.total > 0 && stats.perfect + stats.good === stats.total && stats.bad === 0 && stats.miss === 0) return 'FC';
  if (stats.score >= 960000) return 'V';
  if (stats.score >= 920000) return 'S';
  if (stats.score >= 880000) return 'A';
  if (stats.score >= 820000) return 'B';
  if (stats.score >= 700000) return 'C';
  return 'F';
}

export function resultRecordKey(key: string): string {
  const pathKey = (path: string) => {
    const normalized = path.replace(/(^|\/)res\//, '$1assets/').replace('/assets/s6', '/assets/builtin/s6');
    const resourcePath = normalized.indexOf('/assets/');
    return (resourcePath < 0 ? normalized : normalized.slice(resourcePath)).replace(/\/$/, '') || '/';
  };
  try {
    const parsed = new URL(key);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return key.replace(/\/$/, '');
    return pathKey(parsed.pathname);
  } catch {
    return pathKey(key);
  }
}

export function recordResult(key: string, score: number): number {
  try {
    const records = JSON.parse(localStorage.getItem('pwp.records') || '{}');
    const canonical = resultRecordKey(key);
    const previousValue = records[canonical] ?? Object.entries(records)
      .find(([storedKey]) => resultRecordKey(storedKey) === canonical)?.[1];
    const previous = Number.isInteger(previousValue) && previousValue >= 0 && previousValue <= 1000000 ? previousValue : 0;
    if (score > previous) {
      records[canonical] = score;
      localStorage.setItem('pwp.records', JSON.stringify(records));
    }
    return previous;
  } catch { return 0; }
}
