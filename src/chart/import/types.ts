import type { ChartData, ChartInfo } from '../types';

export interface LocalChart {
  id: string;
  data: ChartData;
  info: ChartInfo;
  music: Blob;
  image?: Blob;
  postfx?: unknown;
  textures?: Record<string, Blob>;
  fonts?: Record<string, Blob>;
  hitsounds?: Record<string, Blob>;
}
export interface LibraryEntry {
  path: string;
  asset?: string;
  cover?: string;
  name: string;
  difficulty: string;
  level: string;
  composer?: string;
  charter?: string;
  song?: string;
  anomaly?: string;
}
