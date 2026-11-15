import type { ChartData } from '../types';
import { parsePec } from './pec';
import { parseRpe } from './rpe';
import { isRpen, parseRpen } from './rpen';

export function parseChart(value: unknown, format?: string): ChartData {
  const hint = format?.trim().toLowerCase();
  if (hint && !['pec', 'rpe', 'rpen', 'phi', 'phigros'].includes(hint)) throw new Error(`暂不支持谱面格式 ${format}`);
  if (typeof value === 'string') {
    const text = value.replace(/^\uFEFF/, '').trim();
    if (hint === 'pec' || (!hint && !text.startsWith('{'))) return parsePec(text);
    try { value = JSON.parse(text); } catch { throw new Error('谱面 JSON 解析失败'); }
  }
  if (hint === 'rpen' || (!hint && isRpen(value))) return parseRpen(value);
  if (hint === 'rpe' || (!hint && value && typeof value === 'object' && ('BPMList' in value || 'META' in value))) return parseRpe(value);
  if (hint === 'pec') throw new Error('PEC 谱面必须为文本');
  if (!value || typeof value !== 'object') throw new Error('谱面必须为 JSON 对象');
  const chart = structuredClone(value) as ChartData;
  if (![1, 3].includes(chart.formatVersion)) throw new Error(`暂不支持谱面版本 ${chart.formatVersion}，请使用 Phigros v1/v3 JSON`);
  if (!Array.isArray(chart.judgeLineList) || !chart.judgeLineList.length) throw new Error('谱面缺少 judgeLineList');
  if (!Number.isFinite(chart.offset)) chart.offset = 0;
  for (const line of chart.judgeLineList) {
    if (!Number.isFinite(line.bpm) || line.bpm <= 0) throw new Error('判定线 BPM 必须大于零');
    for (const key of ['speedEvents', 'judgeLineMoveEvents', 'judgeLineRotateEvents', 'judgeLineDisappearEvents'] as const) {
      if (!Array.isArray(line[key])) throw new Error(`判定线缺少 ${key}`);
      for (const event of line[key]) {
        if (!Number.isFinite(event.startTime) || !Number.isFinite(event.endTime) || event.endTime < event.startTime) throw new Error(`${key} 包含无效事件时间`);
      }
    }
    // Version 1 packs XY coordinates into one integer (x * 1000 + y).
    if (chart.formatVersion === 1) {
      for (const event of line.judgeLineMoveEvents) {
        const start = Number(event.start), end = Number(event.end);
        event.start = Math.floor(start / 1000) / 880; event.start2 = start % 1000 / 520;
        event.end = Math.floor(end / 1000) / 880; event.end2 = end % 1000 / 520;
      }
    }
    for (const key of ['notesAbove', 'notesBelow'] as const) {
      if (!Array.isArray(line[key])) line[key] = [];
      for (const note of line[key]) {
        if (![1, 2, 3, 4].includes(note.type) || !Number.isFinite(note.time) || !Number.isFinite(note.positionX) || !Number.isFinite(note.speed)) throw new Error('谱面包含无效音符');
        if (!Number.isFinite(note.holdTime)) note.holdTime = 0;
        if (note.holdTime < 0) throw new Error('Hold 时长不能为负数');
      }
    }
  }
  chart.formatVersion = 3;
  chart.sourceFormat ??= 'phigros';
  return chart;
}
