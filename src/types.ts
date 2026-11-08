export type NoteType = 1 | 2 | 3 | 4;
export type Grade = 'perfect' | 'good' | 'bad' | 'miss';
export interface ChartEvent {
  startTime: number;
  endTime: number;
  start?: number;
  end?: number;
  start2?: number;
  end2?: number;
  value?: number;
  floorPosition?: number;
  [key: string]: unknown;
}
export interface ChartNote {
  type: NoteType;
  time: number;
  holdTime: number;
  positionX: number;
  speed: number;
  floorPosition?: number;
}
export interface ChartLine {
  bpm: number;
  notesAbove: ChartNote[];
  notesBelow: ChartNote[];
  speedEvents: ChartEvent[];
  judgeLineMoveEvents: ChartEvent[];
  judgeLineRotateEvents: ChartEvent[];
  judgeLineDisappearEvents: ChartEvent[];
}
export interface ChartData {
  formatVersion: number;
  offset: number;
  judgeLineList: ChartLine[];
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
}
export interface RuntimeNote extends ChartNote {
  sect: number;
  secht: number;
  hold_end_time: number;
  is_hold: boolean;
  is_above: boolean;
  clicked: boolean;
  effectId?: number;
  master: { bpm?: number; get_state(time: number): number[] };
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
}
