import JSZip from 'jszip';
import { parse as parseYaml } from 'yaml';
import type { ChartData } from '../types';
import type { LocalChart } from './types';
import { parsePec } from '../formats/pec';
import { parseRpe } from '../formats/rpe';
import { isRpen, parseRpen } from '../formats/rpen';
import { parseChart } from '../formats/parse';
import { isZepcChart, parseZepcChart } from '../formats/zepc';
import { isZepcManifest } from '../formats/manifest';
import { importZepcPack } from './pack';
import { metadataFields, parseInfoText, parseInfoYaml, type MetadataFields } from './metadata';

export { parseChart } from '../formats/parse';

interface Asset { name: string; blob: Blob; group: number; }
const filename = (path: string) => path.replaceAll('\\', '/').split('/').pop() || path;
const parent = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

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
  let group = 0;
  for (const file of files) {
    if (/\.(pez|zip|zepc)$/i.test(file.name)) {
      progress(`解压 ${file.name}`);
      try {
        const zip = await JSZip.loadAsync(file);
        const archive = ++group;
        for (const entry of Object.values(zip.files)) {
          if (entry.dir || /(^|\/)__MACOSX\//.test(entry.name)) continue;
          const blob = await entry.async('blob');
          assets.push({ name: normalizePath(entry.name), blob, group: archive });
        }
      } catch {
        throw new Error(`${file.name}：无法解压，压缩包可能损坏、不完整或格式不支持；请重新下载或重新导出`);
      }
    } else assets.push({ name: normalizePath(file.webkitRelativePath || file.name), blob: file, group: 0 });
  }
  const audio = assets.filter(asset => /\.(ogg|mp3|wav|m4a|flac)$/i.test(asset.name));
  const images = assets.filter(asset => /\.(png|jpe?g|webp|gif|bmp)$/i.test(asset.name));

  // A ZEPC manifest owns its archive (or the loose selection). Parse those
  // groups separately so their chart files are not mistaken for standalone
  // charts and their per-difficulty covers/audio are matched by the manifest.
  const manifests = new Map<number, Asset>();
  for (const asset of assets) {
    if (!/\.ya?ml$/i.test(asset.name) || /(?:^|\/)info\.(?:csv|json|txt|ya?ml)$/i.test(asset.name)) continue;
    let value: unknown;
    try { value = parseYaml((await asset.blob.text()).replace(/^\uFEFF/, '')); } catch { continue; }
    if (!isZepcManifest(value)) continue;
    if (manifests.has(asset.group)) throw new Error('一个压缩包只能包含一个 ZEPC 曲包清单（meta.yaml）');
    manifests.set(asset.group, asset);
  }
  const packed: LocalChart[] = [];
  for (const [group, manifest] of manifests) {
    packed.push(...await importZepcPack(manifest, assets.filter(asset => asset.group === group), progress));
  }
  const normal = assets.filter(asset => !manifests.has(asset.group));
  const metadata: { fields: MetadataFields; dir: string; group: number; priority: number }[] = [];
  const parsed = new Map<Asset, unknown>(), texts = new Map<Asset, string>();
  for (const asset of normal.filter(asset => /(?:^|\/)info\.(?:csv|json|txt|ya?ml)$/i.test(asset.name))) {
    const text = await asset.blob.text(), ext = asset.name.split('.').pop()!.toLowerCase();
    let rows: MetadataFields[], priority: number;
    try {
      if (ext === 'csv') { rows = csvRows(text).map(metadataFields); priority = 30; }
      else if (ext === 'txt') { rows = parseInfoText(text); priority = 40; }
      else if (ext === 'json') { rows = [metadataFields(JSON.parse(text))]; priority = 20; }
      else { rows = [parseInfoYaml(text)]; priority = 50; }
    } catch (error) { throw new Error(`${asset.name}：${error instanceof Error ? error.message : error}`); }
    metadata.push(...rows.map(fields => ({ fields, dir: parent(asset.name), group: asset.group, priority })));
  }
  const key = (path: string) => normalizePath(path).toLowerCase();
  const associated = (asset: Asset) => metadata.filter(row => {
    if (row.group !== asset.group) return false;
    if (!row.fields.chart) return key(row.dir) === key(parent(asset.name));
    if (key(row.dir + row.fields.chart) === key(asset.name) || key(row.fields.chart) === key(asset.name)) return true;
    // Preserve CSV basename associations when exactly one file in this package
    // and metadata directory matches. Repeated basenames need an explicit path.
    if (key(filename(row.fields.chart)) !== key(row.fields.chart) || key(filename(asset.name)) !== key(row.fields.chart)) return false;
    const candidates = assets.filter(value => value.group === asset.group &&
      (!row.dir || key(value.name).startsWith(key(row.dir) + '/')) && key(filename(value.name)) === key(row.fields.chart));
    return candidates.length === 1 && candidates[0] === asset;
  }).sort((a, b) => b.priority - a.priority);
  for (const asset of normal) {
    if (audio.includes(asset) || images.includes(asset) || /\.(?:glsl|frag|vert|mp4|webm|ttf|otf|woff2?|lua)$/i.test(asset.name) ||
        /(?:^|\/)(?:info\.(?:csv|txt|ya?ml)|__MACOSX)(?:$|\/)/i.test(asset.name)) continue;
    if (/\.ya?ml$/i.test(asset.name)) {
      const text = (await asset.blob.text()).replace(/^\uFEFF/, '').trim();
      let value: unknown;
      try { value = parseYaml(text); } catch { throw new Error(`YAML 解析失败：${asset.name}`); }
      if (!isZepcChart(value) && !associated(asset).some(row => row.fields.chart)) continue;
      texts.set(asset, text);
      parsed.set(asset, value);
      continue;
    }
    // A chart referenced by metadata may have any extension. For loose text
    // charts, content detection also covers .pec renamed to .txt or .rpe.
    if (!/\.(?:json|pec|rpe|txt)$/i.test(asset.name) && !associated(asset).some(row => row.fields.chart)) {
      const prefix = (await asset.blob.slice(0, 1024).text()).replace(/^\uFEFF/, '').trimStart();
      if (!prefix.startsWith('{') && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s+(?:bp|n[1-4]|c[vpdarmf])\s/i.test(prefix)) continue;
    }
    const text = (await asset.blob.text()).replace(/^\uFEFF/, '').trim();
    texts.set(asset, text);
    if (text.startsWith('{')) {
      try { parsed.set(asset, JSON.parse(text)); } catch { throw new Error(`JSON 解析失败：${asset.name}`); }
    }
  }
  const charts: LocalChart[] = [];
  for (const [asset, text] of texts) {
    const raw = parsed.get(asset), name = asset.name, rows = associated(asset);
    const isZepc = isZepcChart(raw);
    const isJsonChart = raw && typeof raw === 'object' && 'judgeLineList' in raw;
    const isPec = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s+(?:bp|n[1-4]|c[vpdarmf])\s/i.test(text);
    const explicit = rows.some(row => row.fields.chart);
    if (!isJsonChart && !isPec && !isZepc && !explicit) continue;
    progress(`读取 ${filename(name)}`);
    const field = (key: string): string | undefined => rows.find(row => row.fields[key] !== undefined && row.fields[key] !== '')?.fields[key];
    let data: ChartData;
    const extra = parsed.get(assets.find(value => value.group === asset.group && key(value.name) === key(`${parent(name)}extra.json`))!);
    try {
      const hint = field('format');
      data = isZepc ? parseZepcChart(raw) : (!hint && field('userpen')?.toLowerCase() === 'true') || hint?.trim().toLowerCase() === 'rpen' || (!hint && isRpen(raw))
        ? parseRpen(raw, extra) : parseChart(raw ?? text, hint);
    }
    catch (error) { throw new Error(`${filename(name)}：${error instanceof Error ? error.message : error}`); }
    const dir = parent(name);
    const meta = isJsonChart && ['rpe', 'rpen'].includes(data.sourceFormat ?? '') ? (raw as { META?: Record<string, any> }).META : undefined;
    if (data.rpen) {
      for (const [key, target] of [['linelength', 'lineLength'], ['backgrounddim', 'backgroundDim']] as const) {
        const raw = field(key);
        if (raw === undefined) continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0 || target === 'backgroundDim' && value > 1) throw new Error(`${filename(name)}：${key} 无效`);
        data.rpen[target] = value;
      }
      for (const [key, target] of [['noteuniformscale', 'noteUniformScale'], ['holdpartialcover', 'holdPartialCover']] as const) {
        const value = field(key);
        if (value !== undefined) {
          if (!['true', 'false'].includes(value.toLowerCase())) throw new Error(`${filename(name)}：${key} 必须为布尔值`);
          data.rpen[target] = value.toLowerCase() === 'true';
        }
      }
    }
    const declaredOffset = field('offset');
    if (declaredOffset !== undefined) {
      if (!Number.isFinite(Number(declaredOffset))) throw new Error(`${filename(name)}：元数据 offset 必须为秒数`);
      data.offset += Number(declaredOffset);
    }
    const aspectRatio = field('aspectratio');
    if (aspectRatio !== undefined) {
      const value = Number(aspectRatio);
      if (!Number.isFinite(value) || value <= 0) throw new Error(`${filename(name)}：aspectRatio 必须为正数`);
      data.aspectRatio = value;
    }
    function choose(list: Asset[], requested?: string, defaults: string[] = [], metadataRelative = true): Asset | undefined {
      list = list.filter(value => value.group === asset.group);
      if (requested) {
        const descriptor = metadataRelative ? rows.find(row => row.fields.music === requested || row.fields.image === requested) : undefined;
        for (const path of [descriptor?.dir !== undefined ? descriptor.dir + requested : dir + requested, dir + requested, requested]) {
          const matches = list.filter(value => key(value.name) === key(path));
          if (matches.length === 1) return matches[0];
        }
        const matches = list.filter(value => key(filename(value.name)) === key(requested));
        if (matches.length === 1) return matches[0];
        throw new Error(`${filename(name)} 无法匹配资源：${requested}`);
      }
      for (const fallback of defaults) for (const path of [dir + fallback, fallback]) {
        const matches = list.filter(value => key(value.name) === key(path));
        if (matches.length === 1) return matches[0];
      }
      const nearby = list.filter(asset => key(parent(asset.name)) === key(dir));
      if (nearby.length === 1) return nearby[0];
      if (list.length === 1) return list[0];
      return undefined;
    }
    const textures: Record<string, Blob> = {};
    const fonts: Record<string, Blob> = {}, hitsounds: Record<string, Blob> = {};
    for (const line of data.judgeLineList) {
      const texture = line.animation?.texture;
      if (texture && !textures[texture]) textures[texture] = choose(images, texture, [], false)!.blob;
      for (const event of line.animation?.text ?? []) {
        if (event.font && !fonts[event.font]) {
          if (/\.(ttf|otf|woff2?)$/i.test(event.font)) fonts[event.font] = choose(assets, event.font, [], false)!.blob;
          else data.warnings?.push(`自定义字体 ${event.font} 无对应字体文件，使用默认字体`);
        }
      }
      for (const note of [...line.notesAbove, ...line.notesBelow]) {
        if (note.hitsound && !hitsounds[note.hitsound]) hitsounds[note.hitsound] = choose(audio, note.hitsound, [], false)!.blob;
      }
    }
    const music = choose(audio, field('music') || meta?.song);
    if (!music) throw new Error(`${filename(name)} 无法匹配音乐；请一并选择音乐，或在 info.yml / info.txt / info.csv / info.json 中填写谱面与音乐路径`);
    const textureBlobs = new Set(Object.values(textures));
    const image = choose(field('image') || meta?.background ? images : images.filter(value => !textureBlobs.has(value.blob)),
      field('image') || meta?.background, ['image.png', 'background.png']);
    const shaderAssets = data.rpen ? Object.fromEntries(assets.filter(value => value.group === asset.group &&
      key(value.name).startsWith(key(dir + 'shader') + '/')).map(value => [value.name.slice(dir.length), value.blob])) : undefined;
    const scripts: { name: string; source: string }[] = [];
    const scriptRefs = (data as ChartData & { zepc?: { script?: string[] } }).zepc?.script ?? [];
    for (const reference of new Set(scriptRefs)) {
      const ref = normalizePath(reference);
      const candidates = normal.filter(value => value.group === asset.group);
      let matches = candidates.filter(value => [key(dir + ref), key(ref)].includes(key(value.name)));
      if (!matches.length) matches = candidates.filter(value => key(filename(value.name)) === key(filename(ref)));
      if (matches.length !== 1) throw new Error(`${filename(name)} 无法匹配脚本：${reference}`);
      scripts.push({ name: matches[0].name, source: (await matches[0].blob.text()).replace(/^\uFEFF/, '') });
    }
    charts.push({
      id: `local:${crypto.randomUUID()}`, data, music: music.blob, image: image?.blob,
      info: { name: field('name') || meta?.name || filename(name).replace(/\.[^.]+$/i, ''), level: field('level') || meta?.level || '自制谱',
        composer: field('composer') || meta?.composer, charter: field('charter') || meta?.charter,
        illustrator: field('illustrator') || meta?.illustration },
      postfx: parsed.get(assets.find(value => value.group === asset.group && key(value.name) === key(`${dir}postfx.json`))!),
      textures, fonts, hitsounds, shaderAssets, scripts: scripts.length ? scripts : undefined,
    });
  }
  if (!charts.length && !packed.length) throw new Error('未找到谱面；支持 Phigros v1/v3、PEC、RPE、RPEN、ZEPC 曲包/谱面，以及 PEZ/ZIP 谱面包');
  return [...charts, ...packed];
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}
