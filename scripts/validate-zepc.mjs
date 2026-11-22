#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import JSZip from 'jszip';
import { parse as parseYaml } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(await readFile(new URL('../schema/zepc-v2.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
ajv.addSchema(schema, schema.$id);
const validators = {
  bundle: ajv.compile({ $ref: `${schema.$id}#/$defs/bundle` }),
  chart: ajv.compile({ $ref: `${schema.$id}#/$defs/chart` }),
};

const problems = [];
const add = (code, at, message) => problems.push({ code, at, message });
const pointer = (base, value) => `${base}${value || ''}`;

function stripBlock(document, at) {
  if (!document || typeof document !== 'object' || !Object.prototype.hasOwnProperty.call(document, 'block')) return document;
  add('ZEPC_BLOCK_UNSUPPORTED', `${at}/block`, 'block 噪域尚未在 v2 中定义');
  const { block, ...rest } = document;
  return rest;
}

function schemaProblems(document, at, kind) {
  const validate = validators[kind];
  if (validate(document)) return true;
  for (const error of validate.errors ?? []) {
    const where = pointer(at, error.instancePath);
    const extra = error.keyword === 'additionalProperties' ? `（${error.params.additionalProperty}）` : '';
    add('ZEPC_SCHEMA_INVALID', where, `${error.message}${extra}`);
  }
  return false;
}

class DirSource {
  constructor(root) { this.root = root; }
  key(rel) { return rel.replaceAll('\\', '/'); }
  async has(rel) {
    try { return (await stat(path.join(this.root, this.key(rel)))).isFile(); }
    catch { return false; }
  }
  async text(rel) { return readFile(path.join(this.root, this.key(rel)), 'utf8'); }
}

class ZipSource {
  constructor(files) { this.files = files; }
  key(rel) { return rel.replaceAll('\\', '/'); }
  has(rel) { return this.files.has(this.key(rel)); }
  async text(rel) {
    const entry = this.files.get(this.key(rel));
    if (!entry) throw new Error(`归档中不存在 ${rel}`);
    return entry.async('string');
  }
}

async function openSource(target) {
  const info = await stat(target);
  if (info.isDirectory()) return { source: new DirSource(target), label: target };
  if (!/\.zepc$/i.test(target)) throw new Error('只接受 .zepc 曲包或包含 meta.yaml 的目录');
  const zip = await JSZip.loadAsync(await readFile(target));
  const files = new Map();
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir) files.set(entry.name.replaceAll('\\', '/'), entry);
  }
  return { source: new ZipSource(files), label: target };
}

async function readYaml(source, rel, at) {
  let text;
  try { text = await source.text(rel); }
  catch (error) { add('ZEPC_ASSET_MISSING', at, `无法读取 ${rel}：${error.message}`); return undefined; }
  try { return parseYaml(text.replace(/^\uFEFF/, '')); }
  catch (error) { add('ZEPC_SCHEMA_INVALID', at, `YAML 解析失败：${error.message}`); return undefined; }
}

const extensions = {
  audio: /\.(ogg|mp3|wav|m4a|flac)$/i,
  image: /\.(png|jpe?g|webp|gif|bmp)$/i,
  texture: /\.(png|jpe?g|webp|gif|bmp)$/i,
  font: /\.(ttf|otf|woff2?)$/i,
  hitsound: /\.(ogg|mp3|wav|m4a|flac)$/i,
  postfx: /\.json$/i,
  script: /\.lua$/i,
  chart: /\.(ya?ml)$/i,
  shader: /\.(glsl|frag|vert)$/i,
};

function checkAsset(source, asset, at) {
  if (!extensions[asset.type]?.test(asset.path)) {
    add('ZEPC_REF_TYPE', `${at}/path`, `${asset.type} 资源扩展名不匹配：${asset.path}`);
  }
}

function reference(assets, id, type, at) {
  if (id === undefined || id === null) return;
  const asset = assets.get(id);
  if (!asset) { add('ZEPC_REF_MISSING', at, `引用不存在的 asset：${id}`); return; }
  if (asset.type !== type) add('ZEPC_REF_TYPE', at, `${id} 是 ${asset.type}，需要 ${type}`);
}

function checkTempo(timing, at) {
  const tempo = timing.tempo ?? [];
  if (tempo.length && tempo[0].beat !== 0) add('ZEPC_TEMPO', `${at}/tempo/0/beat`, 'tempo 首拍必须为 0');
  let previous = -Infinity;
  for (const [index, entry] of tempo.entries()) {
    if (entry.beat < previous) add('ZEPC_TEMPO', `${at}/tempo/${index}/beat`, 'tempo 必须按 beat 非递减');
    previous = entry.beat;
  }
}

function checkParents(lines, at) {
  const byId = new Map();
  for (const [index, line] of lines.entries()) {
    if (byId.has(line.id)) add('ZEPC_DUPLICATE_ID', `${at}/lines/${index}/id`, `重复 line id：${line.id}`);
    else byId.set(line.id, line);
  }
  const state = new Map();
  const visit = (line, trail) => {
    if (state.get(line.id) === 2) return;
    if (state.get(line.id) === 1) {
      add('ZEPC_PARENT_CYCLE', `${at}/lines`, `父线成环：${[...trail, line.id].join(' -> ')}`);
      return;
    }
    state.set(line.id, 1);
    if (line.parent !== undefined && line.parent !== null) {
      const parent = byId.get(line.parent);
      if (!parent) add('ZEPC_PARENT_MISSING', `${at}/lines`, `${line.id} 的父线不存在：${line.parent}`);
      else visit(parent, [...trail, line.id]);
    }
    state.set(line.id, 2);
  };
  for (const line of lines) visit(line, []);
}

function checkEventLayers(layers, assets, at) {
  const ids = new Set();
  for (const [layerIndex, layer] of layers.entries()) {
    const layerAt = `${at}/${layerIndex}`;
    if (ids.has(layer.id)) add('ZEPC_DUPLICATE_ID', `${layerAt}/id`, `同一判定线内的事件层 ID 重复：${layer.id}`);
    ids.add(layer.id);

    for (const [key, events] of Object.entries(layer.events)) {
      for (const [eventIndex, event] of events.entries()) {
        const eventAt = `${layerAt}/events/${key}/${eventIndex}`;
        if (event.endBeat < event.startBeat) {
          add('ZEPC_EVENT_TIME', `${eventAt}/endBeat`, '事件结束拍不能早于开始拍');
        }
        if (key === 'text') reference(assets, event.font, 'font', `${eventAt}/font`);
      }
    }
  }
}

function checkChartReferences(chart, assets, at) {
  for (const [lineIndex, line] of chart.lines.entries()) {
    const lineAt = `${at}/lines/${lineIndex}`;
    if (line.texture !== null) reference(assets, line.texture, 'texture', `${lineAt}/texture`);
    for (const [noteIndex, note] of line.notes.entries()) {
      if (note.hitsound !== undefined) reference(assets, note.hitsound, 'hitsound', `${lineAt}/notes/${noteIndex}/hitsound`);
    }
  }
  for (const [index, id] of (chart.scripts ?? []).entries()) reference(assets, id, 'script', `${at}/scripts/${index}`);
}

async function validateChart(document, source, assets, at, expectedId) {
  if (!schemaProblems(stripBlock(document, at), at, 'chart')) return;
  if (expectedId !== undefined && document.id !== expectedId) {
    add('ZEPC_CHART_INVALID', `${at}/id`, `chart.id 必须等于 asset id：${expectedId}`);
  }
  checkTempo(document.timing, `${at}/timing`);
  checkParents(document.lines, at);
  const noteIds = new Map();
  for (const [lineIndex, line] of document.lines.entries()) {
    const lineAt = `${at}/lines/${lineIndex}`;
    checkEventLayers(line.eventLayers, assets, `${lineAt}/eventLayers`);
    for (const [noteIndex, note] of line.notes.entries()) {
      const noteAt = `${lineAt}/notes/${noteIndex}`;
      if (noteIds.has(note.id)) {
        add('ZEPC_DUPLICATE_ID', `${noteAt}/id`, `note id 在全谱重复：${note.id}（另一处 ${noteIds.get(note.id)}）`);
      } else noteIds.set(note.id, noteAt);
      if (note.type === 'hold' && !(note.duration > 0)) add('ZEPC_NOTE_DURATION', `${noteAt}/duration`, 'Hold 必须有时长');
    }
  }
  checkChartReferences(document, assets, at);
}

async function validateBundle(document, source, at) {
  if (!schemaProblems(stripBlock(document, at), at, 'bundle')) return;
  const assets = new Map();
  for (const [index, asset] of document.assets.entries()) {
    const assetAt = `${at}/assets/${index}`;
    if (assets.has(asset.id)) add('ZEPC_DUPLICATE_ID', `${assetAt}/id`, `重复 asset id：${asset.id}`);
    else assets.set(asset.id, asset);
    if (!(await source.has(asset.path))) add('ZEPC_ASSET_MISSING', `${assetAt}/path`, `文件不存在：${asset.path}`);
    checkAsset(source, asset, assetAt);
  }

  reference(assets, document.music, 'audio', `${at}/music`);
  reference(assets, document.cover, 'image', `${at}/cover`);
  reference(assets, document.postfx, 'postfx', `${at}/postfx`);
  for (const [index, id] of (document.scripts ?? []).entries()) reference(assets, id, 'script', `${at}/scripts/${index}`);

  const difficultyIds = new Map();
  for (const [index, difficulty] of document.difficulties.entries()) {
    const difficultyAt = `${at}/difficulties/${index}`;
    if (difficultyIds.has(difficulty.id)) add('ZEPC_DUPLICATE_ID', `${difficultyAt}/id`, `重复 difficulty id：${difficulty.id}`);
    else difficultyIds.set(difficulty.id, difficultyAt);
    reference(assets, difficulty.chart, 'chart', `${difficultyAt}/chart`);
    reference(assets, difficulty.music, 'audio', `${difficultyAt}/music`);
    reference(assets, difficulty.cover, 'image', `${difficultyAt}/cover`);
    reference(assets, difficulty.postfx, 'postfx', `${difficultyAt}/postfx`);
    for (const [scriptIndex, id] of (difficulty.scripts ?? []).entries()) {
      reference(assets, id, 'script', `${difficultyAt}/scripts/${scriptIndex}`);
    }
  }

  for (const [index, asset] of document.assets.entries()) {
    if (asset.type !== 'chart') continue;
    const chartAt = `${at}/assets/${index}`;
    const chart = await readYaml(source, asset.path, `${chartAt}/path`);
    if (chart !== undefined) await validateChart(chart, source, assets, chartAt, asset.id);
  }
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('用法：pnpm validate:zepc <song.zepc|bundle-directory>');
    process.exitCode = 2;
    return;
  }
  let opened;
  try { opened = await openSource(target); }
  catch (error) { console.error(error.message); process.exitCode = 2; return; }
  const { source, label } = opened;
  if (!(await source.has('meta.yaml'))) {
    console.error(`${label}：根目录缺少 meta.yaml`);
    process.exitCode = 1;
    return;
  }
  const document = await readYaml(source, 'meta.yaml', '/meta.yaml');
  if (document !== undefined) {
    if (document?.kind === 'bundle') await validateBundle(document, source, '/meta.yaml');
    else if (document?.kind === 'chart') await validateChart(document, source, new Map(), '/meta.yaml');
    else add('ZEPC_CHART_INVALID', '/kind', '根文档 kind 必须为 bundle 或 chart');
  }

  if (problems.length) {
    for (const problem of problems) console.error(`${problem.code} ${problem.at}: ${problem.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK ${label}`);
}

await main();
