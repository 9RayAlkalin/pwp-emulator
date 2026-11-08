export type NoteType = 1 | 2 | 3 | 4;
export type Grade = 'perfect' | 'good' | 'bad' | 'miss';
export const hudElements = ['pause', 'combonumber', 'combo', 'score', 'bar', 'name', 'level'] as const;
export type HudElement = typeof hudElements[number];
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
  text?: { startTime: number; endTime: number; start: string; end: string; easing?: ChartEasing }[];
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
export interface LocalChart {
  id: string;
  data: ChartData;
  info: ChartInfo;
  music: Blob;
  image?: Blob;
  postfx?: unknown;
  textures?: Record<string, Blob>;
}
export interface RuntimeNote extends ChartNote {
  sect: number;
  secht: number;
  hold_end_time: number;
  is_hold: boolean;
  is_above: boolean;
  clicked: boolean;
  effectId?: number;
  master: { bpm?: number; animation?: LineAnimation; get_viewport?(): { width: number; gameplayScale: number }; get_state(time: number): number[] };
}
export interface Statistics {
  perfect: number;
  good: number;
  bad: number;
  miss: number;
  combo: number;
  maxCombo: number;
  score: number;
  accuracy: number;
  total: number;
}
export interface Settings {
  autoplay: boolean;
  speed: number;
  offset: number;
  volume: number;
  hitVolume: number;
  brightness: number;
  noteScale: number;
  chartAspectRatio: number;
  effects: boolean;
  apFcIndicator: boolean;
  fullscreen: boolean;
  skipLoadingAnimation: boolean;
  playerName: string;
  playerId: string;
  playerAvatar: string;
  playerRks: number;
  playerChallengeModeRank: number;
  playerChallengeModeTier: number;
  playerShowName: boolean;
  collectionDisplay: 'auto' | 'always' | 'never';
  collectionType: 'data' | 'avatar' | 'illustration' | 'file';
  collectionAmount: number;
  collectionName: string;
}
