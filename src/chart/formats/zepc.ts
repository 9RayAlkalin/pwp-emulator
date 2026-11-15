import type { ChartColor, ChartData, ChartEasing, ChartEvent, ChartLine, ChartNote, NoteType } from '../types';
import { hudElements } from '../types';
import { array, combineSpeeds, compileTrack, emptyLine, finite, record, TempoMap, type BeatEvent } from './compiler';
import { optionalText, source, text } from './yaml';

export function isZepcChart(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  if ('difficulties' in raw) return false;
  return 'zepcVersion' in raw || Array.isArray(raw.line);
}

const LIMIT = 1e4;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hexColor(value: string, label: string): ChartColor {
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) throw new Error(`${label} 必须为 #RRGGBB 或 [r, g, b]`);
  return [parseInt(match[1].slice(0, 2), 16), parseInt(match[1].slice(2, 4), 16), parseInt(match[1].slice(4, 6), 16)];
}

function color(value: unknown, label: string, fallback?: ChartColor): ChartColor | undefined {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') return hexColor(value, label);
  if (Array.isArray(value)) {
    if (value.length !== 3) throw new Error(`${label} 必须包含三个 0–255 数值`);
    return value.map(entry => finite(entry, label)) as ChartColor;
  }
  if (typeof value === 'object') {
    const value2 = value as Record<string, unknown>;
    return [0, 1, 2].map(index => finite(value2[index] ?? value2[['r', 'g', 'b'][index]], label)) as ChartColor;
  }
  throw new Error(`${label} 必须为 #RRGGBB 或 [r, g, b]`);
}

function colorChannels(value: ChartColor, label: string): ChartColor {
  if (value.some(channel => channel < 0 || channel > 255)) throw new Error(`${label} 必须包含三个 0–255 数值`);
  return value;
}

function ease(value: unknown, label: string): ChartEasing | undefined {
  if (value === undefined || value === null) return { type: 1 };
  const raw = value;
  if (typeof raw === 'number') {
    const type = finite(raw, label);
    if (!Number.isInteger(type) || type < 1 || type > 29) throw new Error(`${label} 缓动编号必须为 1–29`);
    return { type };
  }
  if (Array.isArray(raw)) {
    const points = raw.map(entry => finite(entry, `${label} 贝塞尔控制点`));
    if (points.length !== 4 || points[0] < 0 || points[0] > 1 || points[2] < 0 || points[2] > 1) {
      throw new Error(`${label} 贝塞尔控制点必须为 [d1, d2, x1, x2] 且 x 在 0–1`);
    }
    return { type: 1, bezier: points };
  }
  if (typeof raw === 'string') {
    const name = raw.trim().toLowerCase().replace(/[\s_-]/g, '');
    const table: Record<string, number> = {
      linear: 1, outsine: 2, insine: 3, outquad: 4, inquad: 5, inoutquad: 6, outquadratic: 4,
      inquadratic: 5, inoutquadratic: 6, outcubic: 7, incubic: 8, inoutcubic: 9,
      outquart: 10, inquart: 11, inoutquart: 12, outquint: 13, inquint: 14, inoutquint: 15,
      outexpo: 16, inexpo: 17, outcirc: 18, incirc: 19, outback: 20, inback: 21,
      inoutcirc: 22, inoutback: 23, outelastic: 24, inelastic: 25, outbounce: 26,
      inbounce: 27, inoutbounce: 28, inoutelastic: 29,
    };
    if (!(name in table)) throw new Error(`${label} 缓动名称未知：${raw}`);
    return { type: table[name] };
  }
  if (typeof raw === 'object') {
    const value2 = raw as Record<string, any>;
    const type = finite(value2.type ?? value2.easingType, `${label}.type`, 1);
    const left = finite(value2.left ?? value2.easingLeft, `${label}.left`, 0);
    const right = finite(value2.right ?? value2.easingRight, `${label}.right`, 1);
    if (!Number.isInteger(type) || type < 1 || type > 29) throw new Error(`${label}.type 必须为 1–29`);
    if (left < 0 || left > 1 || right < 0 || right > 1) throw new Error(`${label} 裁剪范围必须为 0–1`);
    let bezier: number[] | undefined;
    if (value2.bezier === true || value2.bezier === 1) {
      bezier = array(value2.points ?? value2.bezierPoints, `${label}.points`).map(v => finite(v, `${label} 贝塞尔控制点`));
      if (bezier.length !== 4 || bezier[0] < 0 || bezier[0] > 1 || bezier[2] < 0 || bezier[2] > 1) {
        throw new Error(`${label} 贝塞尔控制点必须为 [d1, d2, x1, x2] 且 x 在 0–1`);
      }
    }
    return { type, left, right, bezier };
  }
  throw new Error(`${label} 缓动格式无效`);
}

type Timing = 'beats' | 'seconds';

function timing(value: unknown): Timing {
  if (value === undefined || value === null) return 'beats';
  if (value === 'beats' || value === 'seconds') return value;
  throw new Error('ZEPC timing 必须为 beats 或 seconds');
}

function authoredBeat(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length === 3 && value.every(v => Number.isInteger(v)) && value[2] > 0) {
    return value[0] + value[1] / value[2];
  }
  throw new Error(`${label} 必须为数值或 [小节, 分子, 正分母]`);
}

function numberField(entry: Record<string, any>, names: string[], label: string, fallback: number): number {
  for (const name of names) if (entry[name] !== undefined) return finite(entry[name], label);
  return fallback;
}

function optionalNumber(entry: Record<string, any>, names: string[], label: string): number | undefined {
  for (const name of names) if (entry[name] !== undefined) return finite(entry[name], label);
  return undefined;
}

function track(
  value: unknown,
  label: string,
  read: (entry: Record<string, any>, index: number) => { start: number; end: number; easing?: unknown },
): BeatEvent[] {
  return array(value, label).map((entry, index) => {
    const e = record(entry, `${label}[${index}]`);
    const startBeat = authoredBeat(e.beat ?? e.startBeat ?? e.time ?? e.startTime ?? 0, `${label}[${index}] beat`);
    const endValue = e.endBeat ?? e.endTime ?? e.beatEnd;
    const endBeat = endValue === undefined ? startBeat : authoredBeat(endValue, `${label}[${index}] endBeat`);
    if (endBeat < startBeat) throw new Error(`${label}[${index}] 结束时间不能早于开始时间`);
    const values = read(e, index);
    return {
      startTime: startBeat,
      endTime: endBeat,
      start: values.start,
      end: values.end,
      easing: ease(e.easing ?? e.ease, `${label}[${index}] easing`),
    };
  });
}

function singleTrack(value: unknown, label: string, names: string[], fallback: number): BeatEvent[] {
  return track(value, label, e => {
    const start = numberField(e, names, label, fallback);
    const end = optionalNumber(e, ['to', 'toValue', ...names.map(name => `to${name[0].toUpperCase()}${name.slice(1)}`)], label) ?? start;
    return { start, end };
  });
}

function compileLineTrack(events: BeatEvent[], tempo: TempoMap, factor: number, fallback: number, scale = 1): ChartEvent[] {
  const first = events.reduce<BeatEvent | undefined>((first, event) => !first || event.startTime < first.startTime ? event : first, undefined);
  // Keep the time-zero pose during a positive lead-in instead of exposing
  // far-future notes at the centre.
  const initial = first && first.startTime <= 0 ? first.start! : fallback;
  return compileTrack(events, tempo, initial, factor, scale);
}

export interface ZepcChartMeta {
  script: string[];
}

export function parseZepcChart(value: unknown): ChartData {
  const raw = source(value, 'ZEPC 谱面');
  const version = finite(raw.zepcVersion, 'ZEPC zepcVersion', 1);
  if (version !== 1) throw new Error(`暂不支持 ZEPC 版本 ${version}`);
  const kind = timing(raw.timing);
  let tempo: TempoMap;
  if (kind === 'beats') {
    const bpm = finite(raw.bpm, 'ZEPC bpm', 120);
    if (bpm <= 0) throw new Error('ZEPC bpm 必须大于零');
    const list = raw.bpmList ?? raw.bpms ?? raw.tempo;
    if (list === undefined || list === null) tempo = new TempoMap([{ beat: 0, bpm }]);
    else {
      const changes = array(list, 'ZEPC bpmList').map((entry, index) => {
        const e = record(entry, `ZEPC bpmList[${index}]`);
        const changeBpm = finite(e.bpm ?? e.value, `ZEPC bpmList[${index}] bpm`);
        if (changeBpm <= 0) throw new Error('ZEPC bpmList 的 BPM 必须大于零');
        return { beat: authoredBeat(e.beat ?? e.time ?? 0, `ZEPC bpmList[${index}] beat`), bpm: changeBpm };
      });
      tempo = new TempoMap(changes.length ? changes : [{ beat: 0, bpm }]);
    }
  } else tempo = new TempoMap([{ beat: 0, bpm: 60 }]);
  const toSeconds = (beat: number) => kind === 'beats' ? tempo.seconds(beat) : beat;
  const sources = array(raw.line, 'ZEPC line');
  if (!sources.length) throw new Error('ZEPC 谱面缺少 line');
  const warnings = new Set<string>();
  const lines: ChartLine[] = sources.map((entry, index) => {
    const s = record(entry, `ZEPC 判定线 ${index}`);
    const l = emptyLine();
    const factor = finite(s.bpmFactor ?? s.bpmfactor, `ZEPC 判定线 ${index} bpmFactor`, 1);
    if (factor <= 0) throw new Error('ZEPC bpmFactor 必须大于零');
    const father = finite(s.father, `ZEPC 判定线 ${index} father`, -1);
    if (!Number.isInteger(father) || father < -1 || father >= sources.length || father === index) {
      throw new Error(`ZEPC 判定线 ${index} 的父线索引无效`);
    }
    const animation: NonNullable<ChartLine['animation']> = {
      x: [compileLineTrack(track(s.move ?? s.moves ?? s.moveEvents, `ZEPC 判定线 ${index} moves`, e => {
        const x = numberField(e, ['x', 'startX'], 'ZEPC move x', .5);
        const y = numberField(e, ['y', 'startY'], 'ZEPC move y', .5);
        const toX = optionalNumber(e, ['toX', 'endX'], 'ZEPC move toX') ?? x;
        const toY = optionalNumber(e, ['toY', 'endY'], 'ZEPC move toY') ?? y;
        if (!(x >= 0 && x <= 1) || !(toX >= 0 && toX <= 1)) throw new Error('ZEPC 判定线 x 必须为 0–1 的屏幕位置');
        if (!(y >= 0 && y <= 1) || !(toY >= 0 && toY <= 1)) throw new Error('ZEPC 判定线 y 必须为 0–1 的屏幕位置');
        return { start: x - .5, end: toX - .5 };
      }), tempo, factor, 0)],
      y: [compileLineTrack(track(s.move ?? s.moves ?? s.moveEvents, `ZEPC 判定线 ${index} moves`, e => {
        const y = numberField(e, ['y', 'startY'], 'ZEPC move y', .5);
        const toY = optionalNumber(e, ['toY', 'endY'], 'ZEPC move toY') ?? y;
        if (!(y >= 0 && y <= 1) || !(toY >= 0 && toY <= 1)) throw new Error('ZEPC 判定线 y 必须为 0–1 的屏幕位置');
        return { start: .5 - y, end: .5 - toY };
      }), tempo, factor, 0)],
      rotation: [compileLineTrack(singleTrack(s.rotate ?? s.rotates ?? s.rotateEvents, `ZEPC 判定线 ${index} rotates`,
        ['angle', 'degrees', 'value', 'rotate'], 0), tempo, factor, 0)],
      alpha: [compileLineTrack(singleTrack(s.alpha ?? s.alphas ?? s.alphaEvents, `ZEPC 判定线 ${index} alphas`,
        ['value', 'alpha'], 1), tempo, factor, 1)],
      father,
      rotateWithFather: s.rotateWithFather === true,
      cover: s.cover !== false,
      zOrder: finite(s.zOrder, `ZEPC 判定线 ${index} zOrder`, 0),
    };
    const scaleX = s.scaleX ?? s.scales;
    const scaleY = s.scaleY ?? s.scales;
    if (scaleX !== undefined) animation.scaleX = compileLineTrack(singleTrack(scaleX, `ZEPC 判定线 ${index} scaleX`,
      ['value', 'scale'], 1), tempo, factor, 1);
    if (scaleY !== undefined) animation.scaleY = compileLineTrack(singleTrack(scaleY, `ZEPC 判定线 ${index} scaleY`,
      ['value', 'scale'], 1), tempo, factor, 1);
    const colors = s.color ?? s.colors ?? s.colorEvents;
    if (colors !== undefined) {
      animation.color = [0, 1, 2].map(channel => compileLineTrack(track(colors, `ZEPC 判定线 ${index} colors`, e => {
        const start = colorChannels(color(e.color ?? e.value ?? e.start, 'ZEPC 判定线颜色', [255, 255, 255])!, 'ZEPC 判定线颜色');
        const end = colorChannels(color(e.to ?? e.end ?? e.color ?? e.value, 'ZEPC 判定线目标颜色', start)!, 'ZEPC 判定线目标颜色');
        return { start: start[channel], end: end[channel] };
      }), tempo, factor, 255));
    }
    if (s.texture !== undefined) {
      const texture = text(s.texture, `ZEPC 判定线 ${index} texture`);
      if (texture && texture.replaceAll('\\', '/').toLowerCase() !== 'line.png') animation.texture = texture;
    }
    if (s.anchor !== undefined) {
      const anchor = array(s.anchor, `ZEPC 判定线 ${index} anchor`).map(v => finite(v, 'ZEPC anchor'));
      if (anchor.length !== 2) throw new Error('ZEPC anchor 必须包含两个数值');
      animation.anchor = [anchor[0], anchor[1]];
    }
    if (s.attachUI !== undefined && s.attachUI !== null && s.attachUI !== '') {
      if (hudElements.includes(s.attachUI)) animation.attachUI = s.attachUI;
      else warnings.add(`未知 ZEPC attachUI：${s.attachUI}`);
    }
    if (s.text !== undefined) {
      animation.text = array(s.text, `ZEPC 判定线 ${index} text`).map((entry, textIndex) => {
        const e = record(entry, `ZEPC 判定线 ${index} text[${textIndex}]`);
        const start = authoredBeat(e.beat ?? e.startBeat ?? 0, 'ZEPC 文字开始');
        const end = authoredBeat(e.endBeat ?? e.endTime ?? e.beat ?? e.startBeat ?? 0, 'ZEPC 文字结束');
        if (end < start) throw new Error('ZEPC 文字结束时间不能早于开始时间');
        return {
          startTime: toSeconds(start),
          endTime: toSeconds(end),
          start: text(e.from ?? e.start, 'ZEPC 文字起始内容'),
          end: text(e.to ?? e.end ?? e.from ?? e.start, 'ZEPC 文字结束内容'),
          easing: ease(e.easing ?? e.ease, 'ZEPC 文字 easing'),
          font: optionalText(e.font, 'ZEPC 文字字体'),
        };
      });
    }
    l.animation = animation;
    l.speedEvents = combineSpeeds([compileLineTrack(singleTrack(s.speed ?? s.speeds ?? s.speedEvents,
      `ZEPC 判定线 ${index} speeds`, ['value', 'speed'], 1), tempo, factor, 1)]);
    l.judgeLineMoveEvents = [];
    l.judgeLineRotateEvents = [];
    l.judgeLineDisappearEvents = [];
    for (const [noteIndex, value] of array(s.note, `ZEPC 判定线 ${index} note`).entries()) {
      const n = record(value, `ZEPC 判定线 ${index} 音符 ${noteIndex}`);
      const rawType = n.type;
      let type: NoteType;
      if (typeof rawType === 'number' && Number.isInteger(rawType) && rawType >= 1 && rawType <= 4) type = rawType as NoteType;
      else throw new Error('ZEPC 音符 type 必须为 1–4');
      const startBeat = authoredBeat(n.beat ?? n.time ?? 0, 'ZEPC 音符时间');
      const holdBeats = optionalNumber(n, ['holdBeats', 'durationBeats'], 'ZEPC holdBeats');
      const endValue = n.endBeat ?? n.endTime ?? n.end;
      const endBeat = holdBeats !== undefined ? startBeat + holdBeats
        : endValue !== undefined ? authoredBeat(endValue, 'ZEPC 音符结束时间') : startBeat;
      if (endBeat < startBeat) throw new Error('ZEPC 音符结束时间不能早于开始时间');
      if (type === 3 && endBeat <= startBeat) warnings.add(`ZEPC 判定线 ${index} 音符 ${noteIndex + 1} 是零时长 Hold`);
      const x = numberField(n, ['x', 'positionX'], 'ZEPC 音符 x', .5);
      if (!(x >= 0 && x <= 1)) throw new Error('ZEPC 音符 x 必须为 0–1 的屏幕位置');
      const speed = finite(n.speed, 'ZEPC 音符 speed', 1);
      const size = finite(n.size, 'ZEPC 音符 size', 1);
      const alpha = clamp(finite(n.alpha, 'ZEPC 音符 alpha', 1), 0, 1);
      if (size < 0) throw new Error('ZEPC 音符 size 不能为负数');
      const note: ChartNote = {
        type, time: toSeconds(startBeat), holdTime: type === 3 ? toSeconds(endBeat) - toSeconds(startBeat) : 0,
        positionX: (x - .5) / .05625, speed, isFake: n.fake === true || n.isFake === true,
        size, alpha,
      };
      const tint = color(n.tint ?? n.color, 'ZEPC 音符 tint');
      if (tint) note.tint = colorChannels(tint, 'ZEPC 音符 tint');
      const hitTint = color(n.tintHitEffects, 'ZEPC 音符 tintHitEffects');
      if (hitTint) note.tintHitEffects = colorChannels(hitTint, 'ZEPC 音符 tintHitEffects');
      if (n.hitsound !== undefined) note.hitsound = text(n.hitsound, 'ZEPC 音符 hitsound') || undefined;
      if (n.visibleTime !== undefined) note.visibleTime = finite(n.visibleTime, 'ZEPC 音符 visibleTime');
      if (n.visibleBeats !== undefined) note.visibleTime = toSeconds(startBeat + finite(n.visibleBeats, 'ZEPC 音符 visibleBeats')) - note.time;
      if (n.highlight !== undefined) {
        const highlight = finite(n.highlight, 'ZEPC 音符 highlight');
        if (![0, 1, 2].includes(highlight)) throw new Error('ZEPC 音符 highlight 必须为 0、1 或 2');
        note.highlight = highlight as 0 | 1 | 2;
      }
      (n.above === false || n.below === true ? l.notesBelow : l.notesAbove).push(note);
    }
    return l;
  });
  const visited = new Set<number>(), visiting = new Set<number>();
  function visit(index: number) {
    if (visiting.has(index)) throw new Error('ZEPC 父线存在循环引用');
    if (visited.has(index)) return;
    visiting.add(index);
    const father = lines[index].animation!.father!;
    if (father >= 0) visit(father);
    visiting.delete(index); visited.add(index);
  }
  lines.forEach((_, index) => visit(index));
  const offset = finite(raw.offset, 'ZEPC offset', 0);
  if (Math.abs(offset) > LIMIT) throw new Error('ZEPC offset 超出范围');
  const aspectRatio = raw.aspectRatio === undefined ? undefined : finite(raw.aspectRatio, 'ZEPC aspectRatio');
  if (aspectRatio !== undefined && aspectRatio <= 0) throw new Error('ZEPC aspectRatio 必须为正数');
  const data: ChartData & { zepc?: ZepcChartMeta } = {
    formatVersion: 3, sourceFormat: 'zepc', offset, judgeLineList: lines,
    warnings: [...warnings], aspectRatio,
    zepc: { script: array(raw.script, 'ZEPC 谱面 script').map((entry, index) => {
      if (typeof entry !== 'string' || !entry.trim()) throw new Error(`ZEPC 谱面 script[${index}] 必须为非空路径`);
      return entry;
    }) },
  };
  return data;
}
