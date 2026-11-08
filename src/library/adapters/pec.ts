import type { ChartData, ChartNote, NoteType } from '../../types';
import { compileTrack, combineSpeeds, emptyLine, TempoMap, type BeatEvent } from './common';

interface PecLine { x: BeatEvent[]; y: BeatEvent[]; rotation: BeatEvent[]; alpha: BeatEvent[]; speed: BeatEvent[]; above: ChartNote[]; below: ChartNote[]; }
const noteTypes: NoteType[] = [1, 1, 3, 4, 2];

export function parsePec(text: string): ChartData {
  const tokens = text.replace(/^\uFEFF/, '').trim().split(/\s+/);
  let index = 0, lastNote: ChartNote | undefined;
  const number = (label: string) => {
    const token = tokens[index++];
    if (token === undefined || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token) || !Number.isFinite(Number(token))) throw new Error(`PEC ${label} 缺失或无效（第 ${index} 个字段）`);
    return Number(token);
  };
  const offset = (number('offset') - 175) / 1000;
  const bpms: { beat: number; bpm: number }[] = [], lines = new Map<number, PecLine>();
  function line(): PecLine {
    const id = number('判定线编号');
    if (!Number.isInteger(id) || id < 0 || id >= 30) throw new Error('PEC 判定线编号必须为 0–29');
    if (!lines.has(id)) lines.set(id, { x: [], y: [], rotation: [], alpha: [], speed: [], above: [], below: [] });
    return lines.get(id)!;
  }
  while (index < tokens.length) {
    const command = tokens[index++].toLowerCase();
    if (command === 'bp') { bpms.push({ beat: number('BPM 拍数'), bpm: number('BPM') }); lastNote = undefined; continue; }
    if (command === '#' || command === '&') {
      if (!lastNote) throw new Error(`PEC ${command} 前缺少音符`);
      const v = number(command === '#' ? '音符速度' : '音符宽度');
      if (command === '#') lastNote.speed = v; else lastNote.size = v;
      continue;
    }
    lastNote = undefined;
    if (/^n[1-4]$/.test(command)) {
      const l = line(), kind = Number(command[1]), start = number('音符开始拍'), end = kind === 2 ? number('Hold 结束拍') : start;
      const x = number('音符 X'), side = number('音符方向'), fake = number('假音符标志');
      if (end < start) throw new Error('PEC Hold 结束拍不能早于开始拍');
      if (![1, 2].includes(side) || ![0, 1].includes(fake)) throw new Error('PEC 音符方向或假音符标志无效');
      lastNote = { type: noteTypes[kind], time: start, holdTime: end - start, positionX: x / 115.2, speed: 1, size: 1, isFake: fake === 1 };
      (side === 1 ? l.above : l.below).push(lastNote);
      continue;
    }
    if (!['cv', 'cp', 'cd', 'ca', 'cm', 'cr', 'cf'].includes(command)) throw new Error(`未知 PEC 指令：${command}`);
    const l = line(), startTime = number('事件开始拍');
    const endTime = ['cm', 'cr', 'cf'].includes(command) ? number('事件结束拍') : startTime;
    const v = number('事件值'), y = ['cp', 'cm'].includes(command) ? number('事件 Y') : 0;
    const type = ['cm', 'cr'].includes(command) ? number('缓动类型') : 1;
    if (!Number.isInteger(type) || type < 0 || type > 29) throw new Error('PEC 缓动类型必须为 0–29');
    const e: BeatEvent = { startTime, endTime, end: v, easing: { type: type || 1 } };
    // PEC easing 0 is an immediate assignment.
    if (type === 0) e.endTime = startTime;
    if (command === 'cp' || command === 'cm') { l.x.push(e); l.y.push({ ...e, end: y }); }
    else if (command === 'cv') l.speed.push(e);
    else if (command === 'ca' || command === 'cf') l.alpha.push(e);
    else l.rotation.push(e);
  }
  if (!lines.size) throw new Error('PEC 缺少判定线');
  const tempo = new TempoMap(bpms);
  return { formatVersion: 3, sourceFormat: 'pec', offset, judgeLineList: [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, source]) => {
    const l = emptyLine();
    for (const notes of [source.above, source.below]) for (const n of notes) {
      n.holdInterval = 30 / tempo.bpmAt(n.time);
      const end = tempo.seconds(n.time + n.holdTime);
      n.time = tempo.seconds(n.time); n.holdTime = end - n.time;
    }
    l.notesAbove = source.above; l.notesBelow = source.below;
    l.animation = { x: [compileTrack(source.x, tempo, 1024, 1, 1 / 2048, -.5)],
      y: [compileTrack(source.y, tempo, 700, 1, 1 / 1400, -.5)],
      rotation: [compileTrack(source.rotation, tempo)], alpha: [compileTrack(source.alpha, tempo, 255, 1, 1 / 255)], cover: true, zOrder: 0 };
    l.speedEvents = combineSpeeds([compileTrack(source.speed, tempo, 10, 1, 1 / 7)]);
    return l;
  }) };
}
