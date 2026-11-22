import type { ChartData, ChartInfo } from '../types';

export interface ScriptSource {
  name: string;
  source: string;
}
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
  shaderAssets?: Record<string, Blob>;
  scripts?: ScriptSource[];
  pack?: { name: string; difficulty: string };
  packCharts?: Record<string, LocalChart>;
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
  packFile?: string;
  packChart?: number;
}
