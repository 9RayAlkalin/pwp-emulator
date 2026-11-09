export type NoteType = 1 | 2 | 3 | 4;
export const hudElements = ['pause', 'combonumber', 'combo', 'score', 'bar', 'name', 'level'] as const;
export type HudElement = typeof hudElements[number];
export type ChartColor = [number, number, number];
export interface ChartControl { x: number; value: number; easing: number; }
export interface ChartEvent {
  startTime: number;
  endTime: number;
  start?: number;
  end?: number;
  start2?: number;
  end2?: number;
  value?: number;
  floorPosition?: number;
  floorOrigin?: number;
  endValue?: number;
  easing?: ChartEasing;
  speedCurves?: ChartEvent[];
  [key: string]: unknown;
}
export interface ChartEasing {
  type: number;
  left?: number;
  right?: number;
  bezier?: number[];
  from?: number;
  to?: number;
}
export interface LineAnimation {
  // Adapter tracks use seconds, normalized XY offsets from the screen centre,
  // and clockwise degrees. Layers add; extended properties do not.
  x: ChartEvent[][];
  y: ChartEvent[][];
  rotation: ChartEvent[][];
  alpha: ChartEvent[][];
  scaleX?: ChartEvent[];
  scaleY?: ChartEvent[];
  color?: ChartEvent[][];
  text?: { startTime: number; endTime: number; start: string; end: string; easing?: ChartEasing; font?: string }[];
  controls?: { alpha?: ChartControl[]; size?: ChartControl[]; x?: ChartControl[]; y?: ChartControl[]; skew?: ChartControl[] };
  incline?: ChartEvent[];
  texture?: string;
  anchor?: [number, number];
  gif?: ChartEvent[];
  attachUI?: HudElement;
  father?: number;
  rotateWithFather?: boolean;
  cover: boolean;
  zOrder: number;
}
export interface ChartNote {
  type: NoteType;
  time: number;
  holdTime: number;
  positionX: number;
  speed: number;
  floorPosition?: number;
  isFake?: boolean;
  size?: number;
  alpha?: number;
  visibleTime?: number;
  yOffset?: number;
  judgeArea?: number;
  holdInterval?: number;
  tint?: ChartColor;
  tintHitEffects?: ChartColor;
  hitsound?: string;
  highlight?: 0 | 1 | 2;
}
export interface ChartLine {
  bpm: number;
  notesAbove: ChartNote[];
  notesBelow: ChartNote[];
  speedEvents: ChartEvent[];
  judgeLineMoveEvents: ChartEvent[];
  judgeLineRotateEvents: ChartEvent[];
  judgeLineDisappearEvents: ChartEvent[];
  animation?: LineAnimation;
}
export interface ChartData {
  formatVersion: number;
  offset: number;
  judgeLineList: ChartLine[];
  sourceFormat?: 'phigros' | 'pec' | 'rpe';
  warnings?: string[];
  aspectRatio?: number;
  [key: string]: unknown;
}
export interface ChartInfo {
  name: string;
  level: string;
  music?: string;
  composer?: string;
  charter?: string;
  illustrator?: string;
}
