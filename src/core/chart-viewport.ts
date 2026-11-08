import type { ChartData } from '../types';

export const defaultChartAspect = 16 / 9;
export function resolveChartAspect(chartAspect?: number, override = 0): number {
  return Number.isFinite(override) && override > 0 ? override : chartAspect ?? defaultChartAspect;
}
export interface ChartViewport {
  left: number;
  width: number;
  height: number;
  aspect: number;
  textureScale: number;
  gameplayScale: number;
}

// Match the chart camera: cap very wide screens to the chart's aspect ratio,
// while narrower screens retain their full height. Object pixels use one world
// scale on both axes; normalized line translations still span the viewport.
export function chartViewport(width: number, height: number, aspect = defaultChartAspect): ChartViewport {
  const chartWidth = Math.min(width, height * aspect);
  return { left: (width - chartWidth) / 2, width: chartWidth, height,
    aspect: chartWidth / height, textureScale: chartWidth / 1350,
    gameplayScale: chartWidth / (height * defaultChartAspect) };
}

export function hasChartViewport(data?: ChartData): boolean {
  return data?.sourceFormat === 'rpe' || data?.sourceFormat === 'pec';
}
