import JSZip from 'jszip';
import type { ChartData, ChartInfo, LocalChart } from '../types';

interface Asset { name: string; blob: Blob; }
const filename = (path: string) => path.replaceAll('\\', '/').split('/').pop() || path;
const parent = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

export function parseChart(value: unknown): ChartData {
  if (!value || typeof value !== 'object') throw new Error('谱面必须为 JSON 对象');
  const chart = structuredClone(value) as ChartData;
  if (![1, 3].includes(chart.formatVersion)) throw new Error(`暂不支持谱面版本 ${chart.formatVersion}，请使用 Phigros v1/v3 JSON`);
  if (!Array.isArray(chart.judgeLineList) || !chart.judgeLineList.length) throw new Error('谱面缺少 judgeLineList');
  if (!Number.isFinite(chart.offset)) chart.offset = 0;
  let count = 0;
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
        count++;
      }
    }
  }
  if (count > 200000) throw new Error('谱面音符过多（最多 200000）');
  chart.formatVersion = 3;
  return chart;
}

function csvRows(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) {
      row.push(field.replace(/\r$/, '')); field = '';
      if (c === '\n') { rows.push(row); row = []; }
    } else field += c;
  }
  row.push(field.replace(/\r$/, '')); rows.push(row);
  const headers = rows.shift()?.map(value => value.trim().replace(/^\uFEFF/, '').toLowerCase()) || [];
  return rows.filter(values => values.some(Boolean)).map(values => Object.fromEntries(headers.map((key, i) => [key, values[i] || ''])));
}

export async function importFiles(files: File[], progress: (text: string) => void): Promise<LocalChart[]> {
  const assets: Asset[] = [];
  let total = 0;
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      progress(`解压 ${file.name}`);
      const zip = await JSZip.loadAsync(file);
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || /(^|\/)__MACOSX\//.test(entry.name)) continue;
        if (!/\.(json|csv|ogg|mp3|wav|m4a|flac|png|jpe?g|webp)$/i.test(entry.name)) continue;
        const blob = await entry.async('blob');
        total += blob.size;
        if (total > 512 * 1024 * 1024) throw new Error('导入资源总量超过 512 MB');
        assets.push({ name: entry.name, blob });
      }
    } else { total += file.size; assets.push({ name: file.webkitRelativePath || file.name, blob: file }); }
  }
  if (total > 512 * 1024 * 1024) throw new Error('导入资源总量超过 512 MB');
  const audio = assets.filter(asset => /\.(ogg|mp3|wav|m4a|flac)$/i.test(asset.name));
  const images = assets.filter(asset => /\.(png|jpe?g|webp)$/i.test(asset.name));
  const metadata: Record<string, string>[] = [];
  for (const asset of assets.filter(asset => /(?:^|\/)info\.csv$/i.test(asset.name))) metadata.push(...csvRows(await asset.blob.text()));
  const parsed = new Map<string, unknown>();
  for (const asset of assets.filter(asset => /\.json$/i.test(asset.name))) {
    try { parsed.set(asset.name, JSON.parse(await asset.blob.text())); }
    catch { throw new Error(`JSON 解析失败：${asset.name}`); }
  }
  const charts: LocalChart[] = [];
  for (const [name, raw] of parsed) {
    if (!raw || typeof raw !== 'object' || !('judgeLineList' in raw)) continue;
    progress(`读取 ${filename(name)}`);
    const data = parseChart(raw);
    const dir = parent(name);
    const row = metadata.find(value => value.chart === name || value.chart === filename(name));
    const info = parsed.get(`${dir}info.json`) as Partial<ChartInfo> | undefined;
    function choose(list: Asset[], requested?: string): Asset | undefined {
      if (requested) {
        const found = list.find(asset => asset.name === dir + requested || asset.name === requested || filename(asset.name) === requested);
        if (found) return found;
      }
      const nearby = list.filter(asset => parent(asset.name) === dir);
      if (nearby.length === 1) return nearby[0];
      if (list.length === 1) return list[0];
      return undefined;
    }
    const music = choose(audio, row?.music || info?.music);
    if (!music) throw new Error(`${filename(name)} 无法匹配音乐；请一并选择音乐，或在 info.csv 中填写 Chart、Music、Image`);
    const image = choose(images, row?.image || 'image.png');
    charts.push({
      id: `local:${crypto.randomUUID()}`, data, music: music.blob, image: image?.blob,
      info: { name: row?.name || info?.name || filename(name).replace(/\.json$/i, ''), level: row?.level || info?.level || '自制谱',
        composer: row?.composer || info?.composer, charter: row?.charter || info?.charter,
        illustrator: row?.illustrator || info?.illustrator },
      postfx: parsed.get(`${dir}postfx.json`),
    });
  }
  if (!charts.length) throw new Error('未找到 Phigros JSON 谱面；支持 ZIP，或同时选择 JSON、音乐和曲绘');
  return charts;
}
