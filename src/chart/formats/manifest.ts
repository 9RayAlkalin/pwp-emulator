import { record } from './compiler';
import { optionalText, source, text } from './yaml';

export function isZepcManifest(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.name === 'string' && 'difficulties' in raw && !('line' in raw) && !('zepcVersion' in raw);
}

function stringList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) throw new Error(`${label} 必须为路径或路径数组`);
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) throw new Error(`${label}[${index}] 必须为非空路径`);
    return entry;
  });
}

function pathMap(value: unknown, label: string): Record<string, string> {
  if (value === undefined || value === null) return {};
  const raw = record(value, label);
  return Object.fromEntries(Object.entries(raw).map(([key, entry]) => {
    if (typeof entry !== 'string' || !entry.trim()) throw new Error(`${label}.${key} 必须为资源路径`);
    return [key, entry];
  }));
}

export interface ZepcDifficulty {
  name: string;
  songName?: string;
  level: string;
  chart: string;
  music?: string;
  image?: string;
  postfx?: string;
  charter?: string;
  composer?: string;
  illustrator?: string;
  scripts: string[];
  textures: Record<string, string>;
  fonts: Record<string, string>;
  hitsounds: Record<string, string>;
  shaders?: string;
}

export interface ZepcManifest {
  name: string;
  composer?: string;
  charter?: string;
  illustrator?: string;
  music?: string;
  image?: string;
  postfx?: string;
  scripts: string[];
  difficulties: ZepcDifficulty[];
}

export function parseZepcManifest(value: unknown): ZepcManifest {
  const raw = source(value, 'ZEPC 曲包清单');
  if (!isZepcManifest(raw)) throw new Error('ZEPC 曲包清单缺少 name 或 difficulties');
  const name = text(raw.name, 'ZEPC 曲包 name').trim();
  if (!name) throw new Error('ZEPC 曲包 name 不能为空');
  const defaults = {
    composer: optionalText(raw.composer, 'ZEPC composer'),
    charter: optionalText(raw.charter, 'ZEPC charter'),
    illustrator: optionalText(raw.illustrator, 'ZEPC illustrator'),
    music: optionalText(raw.music ?? raw.song ?? raw.audio, 'ZEPC music'),
    image: optionalText(raw.image ?? raw.cover ?? raw.illustration, 'ZEPC image'),
    postfx: optionalText(raw.postfx, 'ZEPC postfx'),
    scripts: stringList(raw.script, 'ZEPC script'),
    textures: pathMap(raw.textures, 'ZEPC textures'),
    fonts: pathMap(raw.fonts, 'ZEPC fonts'),
    hitsounds: pathMap(raw.hitsounds, 'ZEPC hitsounds'),
    shaders: optionalText(raw.shaders ?? raw.shaderDir, 'ZEPC shaders'),
  };
  const list = raw.difficulties;
  if (list === undefined || list === null) throw new Error('ZEPC 曲包缺少 difficulties');
  const rows: { value: unknown; name?: string }[] = Array.isArray(list)
    ? list.map(entry => ({ value: entry }))
    : Object.entries(record(list, 'ZEPC difficulties')).map(([key, entry]) => ({ value: entry, name: key }));
  if (!rows.length) throw new Error('ZEPC 曲包至少需要一张谱面');
  const difficulties = rows.map((row, index) => {
    const entry = record(row.value, `ZEPC 难度 ${index + 1}`);
    const chart = optionalText(entry.chart ?? entry.file ?? entry.path, `ZEPC 难度 ${index + 1} chart`);
    if (!chart) throw new Error(`ZEPC 难度 ${index + 1} 缺少 chart`);
    const difficultyName = optionalText(entry.name ?? entry.difficulty, `ZEPC 难度 ${index + 1} name`) ?? row.name ?? '';
    const level = optionalText(entry.level ?? entry.rating, `ZEPC 难度 ${index + 1} level`) ?? '';
    return {
      name: difficultyName,
      songName: optionalText(entry.songName, `ZEPC 难度 ${index + 1} songName`),
      level,
      chart,
      music: optionalText(entry.music ?? entry.song ?? entry.audio, `ZEPC 难度 ${index + 1} music`) ?? defaults.music,
      image: optionalText(entry.image ?? entry.cover ?? entry.illustration, `ZEPC 难度 ${index + 1} image`) ?? defaults.image,
      postfx: optionalText(entry.postfx, `ZEPC 难度 ${index + 1} postfx`) ?? defaults.postfx,
      charter: optionalText(entry.charter, `ZEPC 难度 ${index + 1} charter`) ?? defaults.charter,
      composer: optionalText(entry.composer, `ZEPC 难度 ${index + 1} composer`) ?? defaults.composer,
      illustrator: optionalText(entry.illustrator, `ZEPC 难度 ${index + 1} illustrator`) ?? defaults.illustrator,
      scripts: [...defaults.scripts, ...stringList(entry.script, `ZEPC 难度 ${index + 1} script`)],
      textures: { ...defaults.textures, ...pathMap(entry.textures, `ZEPC 难度 ${index + 1} textures`) },
      fonts: { ...defaults.fonts, ...pathMap(entry.fonts, `ZEPC 难度 ${index + 1} fonts`) },
      hitsounds: { ...defaults.hitsounds, ...pathMap(entry.hitsounds, `ZEPC 难度 ${index + 1} hitsounds`) },
      shaders: optionalText(entry.shaders ?? entry.shaderDir, `ZEPC 难度 ${index + 1} shaders`) ?? defaults.shaders,
    };
  });
  return { name, ...defaults, difficulties };
}
