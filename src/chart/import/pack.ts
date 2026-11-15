import { parse as parseYaml } from 'yaml';
import type { ChartData } from '../types';
import type { LocalChart } from './types';
import { parseChart } from '../formats/parse';
import { isZepcChart, parseZepcChart } from '../formats/zepc';
import { parseZepcManifest, type ZepcManifest } from '../formats/manifest';

interface PackAsset { name: string; blob: Blob; }
interface PackContext {
  assets: PackAsset[];
  root: string;
  progress: (text: string) => void;
}

const filename = (path: string) => path.replaceAll('\\', '/').split('/').pop() || path;
const parent = (path: string) => {
  const value = path.replaceAll('\\', '/');
  return value.slice(0, value.lastIndexOf('/') + 1);
};
const key = (path: string) => normalize(path).toLowerCase();

export function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function assetByPath(assets: PackAsset[], path: string): PackAsset | undefined {
  const wanted = key(path);
  return assets.find(asset => key(asset.name) === wanted);
}

function resolveAsset(assets: PackAsset[], base: string | string[], reference: string, label: string, required = true): PackAsset | undefined {
  const ref = normalize(reference);
  if (!ref) throw new Error(`${label} 不能为空`);
  const candidates = [...(Array.isArray(base) ? base : [base]).map(value => normalize(value + ref)), ref];
  for (const candidate of candidates) {
    const exact = assetByPath(assets, candidate);
    if (exact) return exact;
  }
  const sameName = assets.filter(asset => key(filename(asset.name)) === key(filename(ref)));
  if (sameName.length === 1) return sameName[0];
  if (sameName.length > 1) throw new Error(`${label} 无法唯一匹配资源：${reference}（存在 ${sameName.length} 个同名文件）`);
  if (!required) return undefined;
  throw new Error(`${label} 无法匹配资源：${reference}`);
}

function isAudio(name: string): boolean { return /\.(ogg|mp3|wav|m4a|flac)$/i.test(name); }
function isImage(name: string): boolean { return /\.(png|jpe?g|webp|gif|bmp)$/i.test(name); }
function isFont(name: string): boolean { return /\.(ttf|otf|woff2?)$/i.test(name); }

function audioFor(context: PackContext, requested: string | undefined, chart: PackAsset, label: string): PackAsset {
  if (requested) return resolveAsset(context.assets, context.root, requested, `${label} 音频`)!;
  const audio = context.assets.filter(asset => isAudio(asset.name));
  const chartName = key(filename(chart.name).replace(/\.[^.]+$/i, ''));
  const preferred = [`${chartName}.ogg`, `${chartName}.mp3`, `${chartName}.wav`, 'music.ogg', 'music.mp3', 'song.ogg', 'song.mp3', 'audio.ogg', 'audio.mp3'];
  for (const name of preferred) {
    const found = audio.filter(asset => key(filename(asset.name)) === name);
    if (found.length === 1) return found[0];
  }
  const nearby = audio.filter(asset => key(parent(asset.name)) === key(parent(chart.name)));
  if (nearby.length === 1) return nearby[0];
  if (audio.length === 1) return audio[0];
  throw new Error(`${label} 未指定 music，且谱面包中有 ${audio.length} 个音频，无法自动选择`);
}

function imageFor(context: PackContext, requested: string | undefined, chart: PackAsset, used: Set<Blob>, label: string): PackAsset | undefined {
  if (requested) return resolveAsset(context.assets, context.root, requested, `${label} 曲绘`)!;
  const images = context.assets.filter(asset => isImage(asset.name) && !used.has(asset.blob));
  const chartName = key(filename(chart.name).replace(/\.[^.]+$/i, ''));
  const preferred = [`${chartName}.png`, `${chartName}.jpg`, `${chartName}.jpeg`, `${chartName}.webp`,
    'image.png', 'cover.png', 'background.png', 'bg.png'];
  for (const name of preferred) {
    const found = images.filter(asset => key(filename(asset.name)) === name);
    if (found.length === 1) return found[0];
  }
  const nearby = images.filter(asset => key(parent(asset.name)) === key(parent(chart.name)));
  if (nearby.length === 1) return nearby[0];
  return images.length === 1 ? images[0] : undefined;
}

function scriptText(asset: PackAsset): Promise<string> {
  return asset.blob.text().then(value => value.replace(/^\uFEFF/, ''));
}

async function loadScripts(context: PackContext, chart: PackAsset, refs: string[], label: string) {
  const assets: PackAsset[] = [];
  for (const ref of refs) {
    const asset = resolveAsset(context.assets, [parent(chart.name), context.root], ref, `${label} 脚本`)!;
    if (!assets.includes(asset)) assets.push(asset);
  }
  return Promise.all(assets.map(async asset => ({ name: asset.name, source: await scriptText(asset) })));
}

async function chartData(asset: PackAsset): Promise<ChartData> {
  const ext = asset.name.split('.').pop()?.toLowerCase();
  const text = await asset.blob.text();
  const content = text.replace(/^\uFEFF/, '').trim();
  if (ext === 'yaml' || ext === 'yml') {
    let value: unknown;
    try { value = parseYaml(content); } catch (error) { throw new Error(`YAML 解析失败：${error instanceof Error ? error.message : error}`); }
    if (!isZepcChart(value)) throw new Error('ZEPC 曲包中的 YAML 谱面缺少 zepcVersion 或 line');
    return parseZepcChart(value);
  }
  if (ext === 'json') {
    let value: unknown;
    try { value = JSON.parse(content); } catch { throw new Error('JSON 解析失败'); }
    return parseChart(value);
  }
  return parseChart(content);
}

export async function importZepcPack(manifestAsset: PackAsset, assets: PackAsset[], progress: (text: string) => void): Promise<LocalChart[]> {
  progress(`读取曲包 ${filename(manifestAsset.name)}`);
  let manifest: ZepcManifest;
  try {
    const value = parseYaml((await manifestAsset.blob.text()).replace(/^\uFEFF/, ''));
    manifest = parseZepcManifest(value);
  } catch (error) {
    throw new Error(`${manifestAsset.name}：${error instanceof Error ? error.message : error}`);
  }
  const context: PackContext = { assets, root: parent(manifestAsset.name), progress };
  const charts: LocalChart[] = [];
  for (const difficulty of manifest.difficulties) {
    const label = `ZEPC ${manifest.name}${difficulty.name ? ` ${difficulty.name}` : ''}`;
    const displayLevel = (() => {
      const name = difficulty.name, level = difficulty.level;
      if (!level) return name || 'ZEPC';
      return name && !level.toLowerCase().startsWith(name.toLowerCase()) ? `${name} ${level}` : level;
    })();
    const chartAsset = resolveAsset(assets, context.root, difficulty.chart, `${label} 谱面`)!;
    progress(`读取 ${filename(chartAsset.name)}`);
    let data: ChartData;
    try { data = await chartData(chartAsset); }
    catch (error) { throw new Error(`${chartAsset.name}：${error instanceof Error ? error.message : error}`); }
    const music = audioFor(context, difficulty.music, chartAsset, label);

    const textures: Record<string, Blob> = {};
    const textureBlobs = new Set<Blob>();
    for (const [name, path] of Object.entries(difficulty.textures)) {
      const asset = resolveAsset(assets, context.root, path, `${label} 贴图 ${name}`)!;
      textures[name] = asset.blob;
    }
    for (const line of data.judgeLineList) {
      const name = line.animation?.texture;
      if (!name || textures[name]) continue;
      const asset = resolveAsset(assets, parent(chartAsset.name), name, `${label} 贴图 ${name}`)!;
      textures[name] = asset.blob;
    }
    for (const blob of Object.values(textures)) textureBlobs.add(blob);

    const fonts: Record<string, Blob> = {};
    for (const [name, path] of Object.entries(difficulty.fonts)) {
      const asset = resolveAsset(assets, context.root, path, `${label} 字体 ${name}`)!;
      fonts[name] = asset.blob;
    }
    for (const line of data.judgeLineList) {
      for (const event of line.animation?.text ?? []) {
        const name = event.font;
        if (!name || fonts[name] || !isFont(name)) continue;
        const asset = resolveAsset(assets, parent(chartAsset.name), name, `${label} 字体 ${name}`, false);
        if (asset) fonts[name] = asset.blob;
        else data.warnings?.push(`自定义字体 ${name} 无对应字体文件，使用默认字体`);
      }
    }

    const hitsounds: Record<string, Blob> = {};
    for (const [name, path] of Object.entries(difficulty.hitsounds)) {
      const asset = resolveAsset(assets, context.root, path, `${label} 打击音 ${name}`)!;
      hitsounds[name] = asset.blob;
    }
    for (const line of data.judgeLineList) {
      for (const note of [...line.notesAbove, ...line.notesBelow]) {
        const name = note.hitsound;
        if (!name || hitsounds[name]) continue;
        const asset = resolveAsset(assets, parent(chartAsset.name), name, `${label} 打击音 ${name}`)!;
        hitsounds[name] = asset.blob;
      }
    }

    const image = imageFor(context, difficulty.image, chartAsset, textureBlobs, label);
    const postfxAsset = difficulty.postfx
      ? resolveAsset(assets, context.root, difficulty.postfx, `${label} 后期特效`)!
      : assetByPath(assets, parent(chartAsset.name) + 'postfx.json');
    let postfx: unknown;
    if (postfxAsset) {
      try { postfx = JSON.parse(await postfxAsset.blob.text()); }
      catch { throw new Error(`${postfxAsset.name}：postfx JSON 解析失败`); }
    }

    const shaderAssets: Record<string, Blob> = {};
    if (data.rpen) {
      const shaderRoot = difficulty.shaders ? normalize(difficulty.shaders).replace(/\/?$/, '/') : 'shader/';
      const base = shaderRoot.startsWith('/') ? normalize(shaderRoot.slice(1)) : normalize(parent(chartAsset.name) + shaderRoot);
      for (const asset of assets) {
        if (!key(asset.name).startsWith(key(base))) continue;
        shaderAssets[asset.name.slice(base.length)] = asset.blob;
      }
    }

    const chartScripts = (data as ChartData & { zepc?: { script?: string[] } }).zepc?.script ?? [];
    const scripts = await loadScripts(context, chartAsset, [...difficulty.scripts, ...chartScripts], label);
    charts.push({
      id: `local:${crypto.randomUUID()}`,
      data,
      music: music.blob,
      image: image?.blob,
      info: {
        name: manifest.name,
        level: displayLevel,
        music: music.name,
        composer: difficulty.composer,
        charter: difficulty.charter,
        illustrator: difficulty.illustrator,
      },
      postfx,
      textures,
      fonts,
      hitsounds,
      shaderAssets: Object.keys(shaderAssets).length ? shaderAssets : undefined,
      scripts: scripts.length ? scripts : undefined,
      pack: { name: manifest.name, difficulty: displayLevel },
    });
  }
  progress(`曲包 ${manifest.name}：${charts.length} 张谱面`);
  return charts;
}
