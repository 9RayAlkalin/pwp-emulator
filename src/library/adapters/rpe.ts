import type { ChartData, ChartEasing, ChartEvent, ChartNote, NoteType } from '../../types';
import { hudElements } from '../../types';
import { array, beat, combineSpeeds, compileTrack, emptyLine, finite, record, TempoMap, type BeatEvent } from './common';

const noteTypes: NoteType[] = [1, 1, 3, 4, 2];
function easing(e: Record<string, any>): ChartEasing {
  const type = finite(e.easingType, 'RPE easingType', 1);
  if (!Number.isInteger(type) || type < 1 || type > 29) throw new Error('RPE easingType 必须为 1–29');
  const left = finite(e.easingLeft, 'RPE easingLeft', 0), right = finite(e.easingRight, 'RPE easingRight', 1);
  if (left < 0 || right > 1 || left > right) throw new Error('RPE 缓动裁剪范围无效');
  let bezier: number[] | undefined;
  if (e.bezier === 1) {
    bezier = array(e.bezierPoints, 'RPE bezierPoints').map(v => finite(v, 'RPE 贝塞尔控制点'));
    if (bezier.length !== 4 || bezier[0] < 0 || bezier[0] > 1 || bezier[2] < 0 || bezier[2] > 1) throw new Error('RPE 贝塞尔控制点无效');
  }
  return { type, left, right, bezier };
}
function events(raw: unknown, channel?: number): BeatEvent[] {
  return array(raw, 'RPE 事件').map(value => {
    const e = record(value, 'RPE 事件');
    return { startTime: beat(e.startTime), endTime: beat(e.endTime),
      start: finite(channel === undefined ? e.start : e.start?.[channel], 'RPE 事件 start'),
      end: finite(channel === undefined ? e.end : e.end?.[channel], 'RPE 事件 end'), easing: easing(e) };
  });
}

export function parseRpe(value: unknown): ChartData {
  const raw = record(value, 'RPE 谱面'), meta = record(raw.META ?? {}, 'RPE META');
  const source = array(raw.judgeLineList, 'RPE judgeLineList');
  if (!source.length) throw new Error('RPE 缺少判定线');
  const tempo = new TempoMap(array(raw.BPMList, 'RPE BPMList').map(v => {
    const e = record(v, 'RPE BPM'); return { beat: beat(e.startTime), bpm: finite(e.bpm, 'RPE BPM') };
  }));
  const warnings = new Set<string>();
  const lines = source.map((value, index) => {
    const s = record(value, `RPE 判定线 ${index}`), l = emptyLine();
    const factor = finite(s.bpmfactor, 'RPE bpmfactor', 1);
    if (factor <= 0) throw new Error('RPE bpmfactor 必须大于零');
    const layers = array(s.eventLayers, 'RPE eventLayers').filter(v => v != null).map(v => record(v, 'RPE 事件层'));
    const compile = (raw: unknown, fallback = 0, scale = 1, channel?: number) => compileTrack(events(raw, channel), tempo, fallback, factor, scale);
    const tracks = (name: string, scale = 1) => layers.map(layer => compile(layer[name], 0, scale));
    const ext = record(s.extended ?? {}, 'RPE extended');
    const father = finite(s.father, 'RPE father', -1);
    if (!Number.isInteger(father) || father < -1 || father >= source.length || father === index) throw new Error(`RPE 判定线 ${index} 的父线索引无效`);
    l.animation = { x: tracks('moveXEvents', 1 / 1350), y: tracks('moveYEvents', 1 / 900),
      rotation: tracks('rotateEvents'), alpha: tracks('alphaEvents', 1 / 255),
      father, rotateWithFather: s.rotateWithFather === true, cover: s.isCover === undefined || s.isCover === 1,
      zOrder: finite(s.zOrder, 'RPE zOrder', 0) };
    if (ext.scaleXEvents?.length) l.animation.scaleX = compile(ext.scaleXEvents, 1);
    if (ext.scaleYEvents?.length) l.animation.scaleY = compile(ext.scaleYEvents, 1);
    if (ext.colorEvents?.length) l.animation.color = [0, 1, 2].map(channel => compile(ext.colorEvents, 255, 1, channel));
    const anchor = s.anchor === undefined ? [.5, .5] : array(s.anchor, 'RPE anchor');
    if (anchor.length !== 2) throw new Error('RPE anchor 必须包含两个数值');
    l.animation.anchor = [finite(anchor[0], 'RPE anchor X'), finite(anchor[1], 'RPE anchor Y')];
    if (s.Texture != null && typeof s.Texture !== 'string') throw new Error('RPE Texture 必须为文件路径');
    if (s.Texture && s.Texture.replaceAll('\\', '/').toLowerCase() !== 'line.png' && !ext.textEvents?.length) l.animation.texture = s.Texture;
    if (s.attachUI != null && s.attachUI !== '') {
      if (hudElements.includes(s.attachUI)) l.animation.attachUI = s.attachUI;
      else warnings.add(`未知 RPE attachUI：${s.attachUI}`);
    }
    if (ext.gifEvents?.length && l.animation.texture) {
      // Only the event intervals control progress. Gaps use time-based looping.
      l.animation.gif = events(ext.gifEvents).flatMap(e => compileTrack([e], tempo, 0, factor).filter(track => track.easing));
    }
    if (ext.textEvents?.length) {
      l.animation.text = array(ext.textEvents, 'RPE textEvents').flatMap(value => {
        const e = record(value, 'RPE 文字事件');
        if (typeof e.start !== 'string' || typeof e.end !== 'string') throw new Error('RPE 文字事件必须包含字符串');
        const original = { startTime: beat(e.startTime), endTime: beat(e.endTime), start: 0, end: 1, easing: easing(e) };
        const compiled = compileTrack([original], tempo, 0, factor).filter(v => v.easing);
        if (original.startTime === original.endTime) return [{ startTime: tempo.seconds(original.startTime, factor), endTime: tempo.seconds(original.endTime, factor), start: e.start, end: e.end, easing: undefined }];
        return compiled.map(v => ({ startTime: v.startTime, endTime: v.endTime, start: e.start, end: e.end, easing: v.easing }));
      }).sort((a, b) => a.startTime - b.startTime);
    }
    l.speedEvents = combineSpeeds(layers.length ? layers.map(layer => compile(layer.speedEvents, 0, 1 / 4.5)) : [compile(undefined)]);
    const version = finite(meta.RPEVersion, 'RPEVersion', 0);
    if (version >= 162 && version < 170 && layers.some(layer => array(layer.speedEvents, 'RPE speedEvents').some(e => e.easingType && e.easingType !== 1))) warnings.add('RPE 162–169 的非线性流速按当前缓动规则近似播放，旧版导函数行为尚未复现');
    for (const value of array(s.notes, 'RPE notes')) {
      const n = record(value, 'RPE 音符'), type = finite(n.type, 'RPE 音符类型', 1);
      if (!Number.isInteger(type) || type < 1 || type > 4) throw new Error('RPE 音符类型必须为 1–4');
      const start = beat(n.startTime), end = beat(n.endTime ?? n.startTime);
      if (end < start) throw new Error('RPE 音符结束拍不能早于开始拍');
      const time = tempo.seconds(start, factor);
      const note: ChartNote = { type: noteTypes[type], time, holdTime: type === 2 ? tempo.seconds(end, factor) - time : 0,
        positionX: finite(n.positionX, 'RPE positionX', 0) / 75.9375,
        speed: finite(n.speed, 'RPE speed', 1), isFake: n.isFake === 1 || n.isFake === true,
        size: finite(n.size, 'RPE size', 1), alpha: Math.max(0, Math.min(1, finite(n.alpha, 'RPE alpha', 255) / 255)),
        visibleTime: finite(n.visibleTime, 'RPE visibleTime', 999999), yOffset: finite(n.yOffset, 'RPE yOffset', 0) / 540,
        judgeArea: finite(n.judgeArea, 'RPE judgeArea', 1) };
      note.holdInterval = 30 / tempo.bpmAt(start, factor);
      if (note.size! < 0 || note.visibleTime! < 0 || note.judgeArea! < 0) throw new Error('RPE 音符宽度、可见时间与判定区域不能为负数');
      (n.above === undefined || n.above === 1 ? l.notesAbove : l.notesBelow).push(note);
      if (n.hitsound) warnings.add('自定义打击音尚未播放，使用默认音效');
      if ([n.tint, n.color, n.tintHitEffects].some(c => c && (!Array.isArray(c) || c.some(v => v !== 255)))) warnings.add('音符及打击特效自定义染色尚未渲染');
    }
    for (const [field, key, neutral] of [['alphaControl', 'alpha', 1], ['sizeControl', 'size', 1], ['posControl', 'pos', 1], ['yControl', 'y', 1], ['skewControl', 'skew', 0]] as const) {
      if (array(s[field], `RPE ${field}`).some(c => c[key] !== neutral)) warnings.add('RPE 距离控制器尚未渲染');
    }
    if (array(ext.inclineEvents, 'RPE inclineEvents').some(e => e.start !== 0 || e.end !== 0)) warnings.add('RPE 判定线倾斜尚未渲染');
    if (ext.paintEvents?.length) warnings.add('RPE 画笔事件尚未渲染');
    if (array(ext.textEvents, 'RPE textEvents').some(e => e.font && e.font !== 'cmdysj')) warnings.add('RPE 自定义字体使用浏览器默认字体替代');
    return l;
  });
  const visited = new Set<number>(), visiting = new Set<number>();
  function visit(index: number) {
    if (visiting.has(index)) throw new Error('RPE 父线存在循环引用');
    if (visited.has(index)) return;
    visiting.add(index);
    const father = lines[index].animation!.father!;
    if (father >= 0) visit(father);
    visiting.delete(index); visited.add(index);
  }
  lines.forEach((_, i) => visit(i));
  return { formatVersion: 3, sourceFormat: 'rpe', offset: -finite(meta.offset, 'RPE META.offset', 0) / 1000,
    judgeLineList: lines, warnings: [...warnings] };
}
