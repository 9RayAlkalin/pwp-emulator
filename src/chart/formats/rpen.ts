import type { ChartData, ChartEasing } from '../types';
import { parseRpe } from './rpe';
import { array, beat, finite, record, TempoMap } from './compiler';

export type ShaderValue = number | number[];
export interface RpenEvent {
  startTime: number; endTime: number; start: number; end: number; easing: ChartEasing;
  anchor?: { x: number; y: number }; transformStart?: number; transformEnd?: number;
}
export interface NoiseArea {
  layer: string; invert: boolean; appear: number; disappear: number;
  center: { x: number; y: number }; size: { x: number; y: number };
  active: { start: number; end: number; ready: number }[];
  tracks: Record<'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY', RpenEvent[]>;
}
export interface NoiseLayer { id: string; skin: string; channel: 'normal' | 'low'; parameters: Record<string, ShaderValue>; }
export interface ShaderEffect {
  shader: string; global: boolean; order: number; start: number; end: number;
  vars: Record<string, ShaderValue | RpenEvent[][]>;
}
export interface RpenData {
  areas: NoiseArea[]; layers: NoiseLayer[]; effects: ShaderEffect[];
  lineLength?: number; backgroundDim?: number; noteUniformScale?: boolean; holdPartialCover?: boolean;
}

export function isRpen(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, any>;
  return !!raw.META && (raw.META.RPEVersion >= 200 || 'noiseAreaLayers' in raw ||
    !!raw.blockAreaList?.length || 'effects' in raw || 'shaderEvents' in raw || !!raw.META.effects);
}

function curve(e: Record<string, any>): ChartEasing {
  const type = finite(e.easingType, 'RPEN easingType', 1);
  if (!Number.isInteger(type) || type < 1 || type > 29) throw new Error('RPEN easingType 必须为 1–29');
  const left = finite(e.easingLeft, 'RPEN easingLeft', 0), right = finite(e.easingRight, 'RPEN easingRight', 1);
  if (left < 0 || right > 1 || right <= left) throw new Error('RPEN 缓动裁剪范围无效');
  const bezier = e.bezier ? array(e.bezierPoints, 'RPEN bezierPoints').map(v => finite(v, 'RPEN 贝塞尔控制点')) : undefined;
  if (bezier && (bezier.length !== 4 || bezier[0] < 0 || bezier[0] > 1 || bezier[2] < 0 || bezier[2] > 1)) throw new Error('RPEN 贝塞尔控制点无效');
  // Custom animation curves need their own evaluator; never silently play them as linear.
  if (e.customEasing || e.trajectory) throw new Error('RPEN 自定义动画曲线暂不支持');
  return { type, left, right, bezier };
}
const point = (value: unknown, label: string) => {
  const p = record(value, label); return { x: finite(p.x, label + '.x'), y: finite(p.y, label + '.y') };
};
function shaderValue(value: unknown, label: string): ShaderValue {
  if (!Array.isArray(value)) return finite(value, label);
  if (![2, 3, 4].includes(value.length)) throw new Error(label + ' 必须为标量或 vec2/3/4');
  return value.map(v => finite(v, label));
}

// RPEN shares RPE's note/line vocabulary. Its extensions have a separate parser
// and a separate runtime model; native Phigros blocks are never fed RPEN data.
export function parseRpen(value: unknown, extra?: unknown): ChartData {
  const raw = record(value, 'RPEN 谱面'), data = parseRpe(raw);
  const tempo = new TempoMap(array(raw.BPMList, 'RPEN BPMList').map(v => ({ beat: beat(v.startTime), bpm: finite(v.bpm, 'RPEN BPM') })));
  const time = (v: unknown, factor = 1) => tempo.seconds(Array.isArray(v) ? beat(v) : finite(v, 'RPEN 时间'), factor);
  const track = (input: unknown, factor = 1, component?: number): RpenEvent[] => array(input, 'RPEN 事件').map(v => {
    const e = record(v, 'RPEN 事件'), startTime = time(e.startTime, factor), endTime = time(e.endTime, factor);
    if (endTime < startTime) throw new Error('RPEN 事件结束时间早于开始时间');
    const number = (v: unknown) => finite(component === undefined ? v : (v as number[])?.[component], 'RPEN 事件数值');
    return { startTime, endTime, start: number(e.start), end: number(e.end), easing: curve(e),
      anchor: e.anchor == null ? undefined : point(e.anchor, 'RPEN anchor'),
      transformStart: e.transformStart === undefined ? undefined : finite(e.transformStart, 'RPEN transformStart'),
      transformEnd: e.transformEnd === undefined ? undefined : finite(e.transformEnd, 'RPEN transformEnd') };
  }).sort((a, b) => a.startTime - b.startTime);
  const layers: NoiseLayer[] = array(raw.noiseAreaLayers ?? [{ id: 'default', skin: '' }], 'RPEN 噪域层').map(v => {
    const l = record(v, 'RPEN 噪域层');
    if (typeof l.id !== 'string' || !l.id || l.skin != null && typeof l.skin !== 'string') throw new Error('RPEN 噪域层 id/skin 无效');
    if (l.channel != null && !['normal', 'low'].includes(l.channel)) throw new Error('RPEN 噪域层 channel 无效');
    return { id: l.id, skin: l.skin || '', channel: l.channel || 'normal',
      parameters: Object.fromEntries(Object.entries(record(l.parameters ?? {}, 'RPEN 皮肤参数')).map(([k, v]) => [k, shaderValue(v, k)])) };
  });
  const ids = new Set(layers.map(l => l.id));
  if (ids.size !== layers.length) throw new Error('RPEN 噪域层 id 重复');
  const areas: NoiseArea[] = array(raw.blockAreaList, 'RPEN blockAreaList').map(v => {
    const b = record(v, 'RPEN 噪域'), bl = point(b.bottomLeft, 'RPEN bottomLeft'), tr = point(b.topRight, 'RPEN topRight');
    const appear = time(b.appearTime), disappear = time(b.disappearTime), layer = b.layerId ?? 'default';
    if (disappear < appear || !ids.has(layer)) throw new Error('RPEN 噪域时间/所属层无效');
    const intervals = array(b.activeIntervals, 'RPEN activeIntervals').flatMap(v => {
      const e = record(v, 'RPEN 激活区间');
      const start = time(e.startTime), end = time(e.endTime);
      if (end < start) throw new Error('RPEN 激活区间时间无效');
      const ready = typeof e.readyFlash === 'boolean' ? e.readyFlash ? .5 : 0 : finite(e.readyFlash, 'RPEN readyFlash', .5);
      const clippedStart = Math.max(appear,start), clippedEnd = Math.min(disappear,end);
      return clippedEnd > clippedStart || start === end && clippedStart === clippedEnd
        ? [{ start: clippedStart, end: clippedEnd, ready: Math.round(Math.max(0, ready) * 1000) / 1000 }] : [];
    }).sort((a, b) => a.start - b.start);
    const active: NoiseArea['active'] = [];
    for (const e of intervals) {
      const previous = active.at(-1);
      if (previous?.start === e.start) { previous.end = Math.max(previous.end,e.end); previous.ready = Math.max(previous.ready,e.ready); }
      else active.push(e);
    }
    return { layer, invert: !!b.isInvert, appear, disappear, active,
      center: { x: (bl.x + tr.x) / 2, y: (bl.y + tr.y) / 2 }, size: { x: Math.abs(tr.x - bl.x), y: Math.abs(tr.y - bl.y) },
      tracks: { x: track(b.moveXEvents), y: track(b.moveYEvents), rotation: track(b.rotateEvents), scaleX: track(b.scaleXEvents), scaleY: track(b.scaleYEvents) } };
  });
  const embedded = [...array(raw.effects, 'RPEN effects'), ...array(raw.shaderEvents, 'RPEN shaderEvents'), ...array(raw.META?.effects, 'RPEN META.effects')];
  const root = embedded.length ? embedded : array(extra == null ? undefined : record(extra, 'RPEN extra.json').effects, 'RPEN extra.effects');
  const effects = [...root, ...array(raw.judgeLineList, 'RPEN 判定线').flatMap((l, line) =>
    array(l.extended?.paintEvents, 'RPEN paintEvents').map(e => ({ ...e, line })))].map(v => {
    const e = record(v, 'RPEN shader event');
    if (typeof e.shader !== 'string' || !e.shader.trim()) throw new Error('RPEN shader 必须为名称或路径');
    const owner = Number.isInteger(e.line) ? ((e.line % raw.judgeLineList.length) + raw.judgeLineList.length) % raw.judgeLineList.length : 0;
    const factor = finite(raw.judgeLineList[owner]?.bpmfactor, 'RPEN shader bpmfactor', 1);
    const start = time(e.startTime ?? e.start, factor), end = time(e.endTime ?? e.end, factor);
    if (end < start) throw new Error('RPEN shader 事件时间无效');
    const vars = Object.fromEntries(Object.entries(record(e.vars ?? {}, 'RPEN shader vars')).map(([k, value]) => {
      if (Array.isArray(value) && value.length && typeof value[0] === 'object') {
        const first = value[0].start;
        const dimensions = Array.isArray(first) ? first.length : 1;
        shaderValue(first, k);
        return [k, Array.from({ length: dimensions }, (_, c) => track(value, factor, dimensions === 1 ? undefined : c))];
      }
      return [k, shaderValue(value, k)];
    }));
    return { shader: e.shader, global: !!e.global, order: finite(e.order, 'RPEN shader order', 0), start, end, vars } as ShaderEffect;
  }).sort((a, b) => a.order - b.order || a.start - b.start);
  data.sourceFormat = 'rpen';
  data.warnings = data.warnings?.filter(w => w !== 'RPE 画笔事件尚未渲染');
  if (raw.globalEvents) data.warnings?.push('RPEN globalEvents 摄像机/全局动画尚未接入');
  data.rpen = { areas, layers, effects };
  return data;
}
