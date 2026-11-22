/* A deliberately small Lua host for ZEPC charts.
 *
 * The VM is Fengari (Lua 5.3 in JavaScript). Scripts get base/string/table/
 * math/utf8/coroutine and a `pwp` table; filesystem, package, debug and OS
 * libraries are never opened. Every hook runs under a VM instruction budget so
 * a runaway loop cannot freeze the player. */
import lua from 'fengari/src/lua.js';
import lauxlib from 'fengari/src/lauxlib.js';
import base from 'fengari/src/lbaselib.js';
import coroutine from 'fengari/src/lcorolib.js';
import table from 'fengari/src/ltablib.js';
import string from 'fengari/src/lstrlib.js';
import math from 'fengari/src/lmathlib.js';
import utf8 from 'fengari/src/lutf8lib.js';
import core from 'fengari/src/fengaricore.js';

export type ScriptGrade = 'perfect' | 'good' | 'bad' | 'miss';
export type ScriptColor = [number, number, number];

export interface ScriptSource {
  name: string;
  source: string;
}

export interface ScriptNote {
  id: string;
  line: number;
  index: number;
  type: 'tap' | 'drag' | 'hold' | 'flick';
  time: number;
  holdTime: number;
  x: number;
  speed: number;
  above: boolean;
  fake: boolean;
}

export interface ScriptState {
  time: number;
  duration: number;
  playing: boolean;
  progress: number;
  score: number;
  accuracy: number;
  combo: number;
  maxCombo: number;
  perfect: number;
  good: number;
  bad: number;
  miss: number;
  total: number;
  width?: number;
  height?: number;
  spectrum?: number;
  autoplay?: boolean;
  exporting?: boolean;
}

export interface ScriptElement {
  x: number; y: number; width: number; height: number;
  texture?: string; text?: string; action?: string;
  color?: ScriptColor; alpha: number; rotation: number; size: number;
}
export interface ScriptDisplay {
  score?: number; combo?: string; level?: string; progress?: number;
}

export interface ScriptLineStyle {
  color?: ScriptColor;
  alpha?: number;
  scale?: number;
  visible?: boolean;
}
export interface ScriptNoteStyle {
  tint?: ScriptColor;
  alpha?: number;
  width?: number;
  visible?: boolean;
}
export interface ScriptHud {
  text: string;
  x: number;
  y: number;
  size: number;
  align: 'left' | 'center' | 'right';
  color?: ScriptColor;
  alpha: number;
}
export interface ScriptOverlay {
  background?: { color: ScriptColor; alpha: number };
  lines: Map<number, ScriptLineStyle>;
  notes: Map<string, ScriptNoteStyle>;
  hud?: ScriptHud;
  screen?: { color: ScriptColor; alpha: number };
  display: ScriptDisplay;
  elements: Map<string, ScriptElement>;
  musicVolume: number;
  loops: Map<string, { volume: number; rate: number }>;
}
export type ScriptAction = { type: 'pause' } | { type: 'play' } | { type: 'seek'; time: number }
  | { type: 'chart'; name: string } | { type: 'finish' } | { type: 'sound'; name: string; volume: number };

export interface ScriptHost {
  readonly overlay: ScriptOverlay;
  readonly errors: string[];
  readonly logs: string[];
  readonly ready: boolean;
  load(state: ScriptState): void;
  reset(state: ScriptState): void;
  update(dt: number, state: ScriptState): void;
  judge(note: ScriptNote, grade: ScriptGrade, state: ScriptState): ScriptGrade;
  hit(note: ScriptNote, grade: ScriptGrade, state: ScriptState): void;
  finish(state: ScriptState): void;
  action(name: string, state: ScriptState): void;
  pointer(x: number, y: number, state: ScriptState): boolean;
  takeActions(): ScriptAction[];
  dispose(): void;
}

const grades = new Set<ScriptGrade>(['perfect', 'good', 'bad', 'miss']);
const MAX_SCRIPT_SIZE = 256 * 1024;
const MAX_LOGS = 200;
const COUNT_HOOK = 1000;
const BUDGET = { load: 3_000_000, reset: 800_000, update: 300_000, judge: 120_000, finish: 300_000 };

function isColor(value: unknown): value is ScriptColor {
  return Array.isArray(value) && value.length === 3 && value.every(entry => typeof entry === 'number' && Number.isFinite(entry));
}
function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function readColor(value: unknown): ScriptColor | undefined {
  if (isColor(value)) return value.map(channel => clamp(channel, 0, 255)) as ScriptColor;
  if (isObject(value)) {
    const r = finite(value.r, NaN), g = finite(value.g, NaN), b = finite(value.b, NaN);
    if ([r, g, b].every(Number.isFinite)) return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)];
  }
  if (typeof value === 'string') {
    const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
    if (match) return [parseInt(match[1].slice(0, 2), 16), parseInt(match[1].slice(2, 4), 16), parseInt(match[1].slice(4, 6), 16)];
  }
  return undefined;
}

function emptyOverlay(): ScriptOverlay {
  return { lines: new Map(), notes: new Map(), elements: new Map(), display: {}, musicVolume: 1, loops: new Map() };
}

function clearOverlay(overlay: ScriptOverlay): void {
  overlay.lines.clear(); overlay.notes.clear(); overlay.elements.clear();
  overlay.hud = undefined; overlay.background = undefined; overlay.screen = undefined;
  overlay.display = {}; overlay.musicVolume = 1;
  overlay.loops.clear();
}

function readValue(L: any, index: number, depth = 0): unknown {
  if (depth > 16) return undefined;
  const type = lua.lua_type(L, index);
  if (type === lua.LUA_TNIL || type === lua.LUA_TNONE) return undefined;
  if (type === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, index);
  if (type === lua.LUA_TNUMBER) return lua.lua_tonumberx(L, index);
  if (type === lua.LUA_TSTRING) return lua.lua_tojsstring(L, index);
  if (type === lua.LUA_TTABLE) return readTable(L, index, depth + 1);
  return undefined;
}

function readTable(L: any, index: number, depth = 0): unknown {
  index = lua.lua_absindex(L, index);
  const values: Record<string, unknown> = {};
  let numeric = 0, max = 0, sequence = true, count = 0;
  lua.lua_pushnil(L);
  while (lua.lua_next(L, index) !== 0) {
    const keyType = lua.lua_type(L, -2);
    const numberKey = keyType === lua.LUA_TNUMBER ? lua.lua_tonumberx(L, -2) : undefined;
    const key = keyType === lua.LUA_TNUMBER ? String(numberKey) : lua.lua_tojsstring(L, -2);
    const value = readValue(L, -1, depth);
    if (key !== null) values[key] = value;
    if (typeof numberKey === 'number' && Number.isInteger(numberKey) && numberKey >= 1) {
      numeric++; max = Math.max(max, numberKey);
    } else sequence = false;
    count++;
    lua.lua_pop(L, 1);
  }
  if (sequence && numeric > 0 && numeric === max) return Array.from({ length: max }, (_, i) => values[String(i + 1)]);
  return count ? values : {};
}

function pushValue(L: any, value: unknown): void {
  if (value === undefined || value === null) lua.lua_pushnil(L);
  else if (typeof value === 'boolean') lua.lua_pushboolean(L, value);
  else if (typeof value === 'number') lua.lua_pushnumber(L, value);
  else if (typeof value === 'string') lua.lua_pushliteral(L, value);
  else if (Array.isArray(value)) {
    lua.lua_createtable(L, value.length, 0);
    value.forEach((entry, index) => {
      lua.lua_pushinteger(L, index + 1);
      pushValue(L, entry);
      lua.lua_settable(L, -3);
    });
  } else if (typeof value === 'object') {
    lua.lua_createtable(L, 0, 0);
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      lua.lua_pushliteral(L, key);
      pushValue(L, entry);
      lua.lua_settable(L, -3);
    }
  } else lua.lua_pushnil(L);
}

export function createScriptHost(scripts: readonly ScriptSource[]): ScriptHost {
  const overlay = emptyOverlay();
  const errors: string[] = [];
  const logs: string[] = [];
  const actions: ScriptAction[] = [];
  const warned = new Set<string>();
  let disposed = false;
  let loaded = false;
  let finished = false;
  let resets = 0;
  let ready = false;
  const guard = { used: 0, limit: 0 };

  const report = (message: string) => {
    if (warned.has(message)) return;
    warned.add(message);
    errors.push(message);
    if (errors.length > 50) errors.splice(0, errors.length - 50);
    console.warn('[pwp script]', message);
  };

  const L = (() => {
    try { return lauxlib.luaL_newstate(); }
    catch (error) { report(`Lua VM 初始化失败：${error instanceof Error ? error.message : error}`); return null; }
  })();

  if (L) {
    try {
      for (const [name, open] of [['_G', base.luaopen_base], ['coroutine', coroutine.luaopen_coroutine],
        ['table', table.luaopen_table], ['string', string.luaopen_string],
        ['math', math.luaopen_math], ['utf8', utf8.luaopen_utf8]] as const) {
        lauxlib.luaL_requiref(L, name, open, 1);
        lua.lua_pop(L, 1);
      }
      for (const name of ['dofile', 'loadfile', 'load', 'require', 'collectgarbage', 'module', 'arg',
        'package', 'io', 'os', 'debug', 'utf8.charpattern']) {
        // utf8.charpattern is harmless; keep it. Everything else is removed.
        if (name === 'utf8.charpattern') continue;
        lua.lua_pushnil(L);
        lua.lua_setglobal(L, name);
      }
      const log = (L: any) => {
        const top = lua.lua_gettop(L), parts: string[] = [];
        for (let i = 1; i <= top; i++) parts.push(String(readValue(L, i) ?? 'nil'));
        const text = parts.join('\t');
        if (logs.length < MAX_LOGS) logs.push(text);
        console.info('[pwp]', text);
        return 0;
      };
      lua.lua_pushcfunction(L, log);
      lua.lua_setglobal(L, 'print');

      lua.lua_createtable(L, 0, 0);
      const api = (name: string, fn: (L: any) => number) => {
        lua.lua_pushliteral(L, name);
        lua.lua_pushcfunction(L, fn);
        lua.lua_settable(L, -3);
      };
      api('log', log);
      api('line', (L: any) => {
        const line = lua.lua_tonumberx(L, 1);
        if (!Number.isFinite(line) || line < 1) return 0;
        if (lua.lua_isnoneornil(L, 2)) { overlay.lines.delete(Math.floor(line)); return 0; }
        const props = readValue(L, 2);
        if (!isObject(props)) return 0;
        const style: ScriptLineStyle = { ...overlay.lines.get(Math.floor(line)) };
        const color = readColor(props.color);
        if (color) style.color = color;
        if (typeof props.alpha === 'number' && Number.isFinite(props.alpha)) style.alpha = clamp(props.alpha, 0, 1);
        if (typeof props.scale === 'number' && Number.isFinite(props.scale)) style.scale = clamp(props.scale, 0, 100);
        if (typeof props.visible === 'boolean') style.visible = props.visible;
        overlay.lines.set(Math.floor(line), style);
        return 0;
      });
      api('note', (L: any) => {
        const id = lua.lua_tojsstring(L, 1);
        if (id === null) return 0;
        if (lua.lua_isnoneornil(L, 2)) { overlay.notes.delete(id); return 0; }
        const props = readValue(L, 2);
        if (!isObject(props)) return 0;
        const style: ScriptNoteStyle = { ...overlay.notes.get(id) };
        const tint = readColor(props.tint ?? props.color);
        if (tint) style.tint = tint;
        if (typeof props.alpha === 'number' && Number.isFinite(props.alpha)) style.alpha = clamp(props.alpha, 0, 1);
        const width = props.width ?? props.size;
        if (typeof width === 'number' && Number.isFinite(width)) style.width = clamp(width, 0, 100);
        if (typeof props.visible === 'boolean') style.visible = props.visible;
        overlay.notes.set(id, style);
        return 0;
      });
      api('background', (L: any) => {
        if (lua.lua_isnoneornil(L, 1)) { overlay.background = undefined; return 0; }
        const value = readValue(L, 1);
        if (typeof value === 'string' && ['none', 'clear', 'off'].includes(value.toLowerCase())) { overlay.background = undefined; return 0; }
        const color = readColor(value);
        if (!color) return 0;
        overlay.background = { color, alpha: clamp(finite(readValue(L, 2), 1), 0, 1) };
        return 0;
      });
      api('hud', (L: any) => {
        if (lua.lua_isnoneornil(L, 1)) { overlay.hud = undefined; return 0; }
        const text = lua.lua_tojsstring(L, 1);
        if (text === null || text === '') { overlay.hud = undefined; return 0; }
        const options = readValue(L, 2);
        const o = isObject(options) ? options : {};
        const align = o.align === 'left' || o.align === 'right' ? o.align : 'center';
        overlay.hud = {
          text,
          x: clamp(finite(o.x, .5), 0, 1), y: clamp(finite(o.y, .06), 0, 1),
          size: clamp(finite(o.size, .05), .005, 1), align,
          color: readColor(o.color), alpha: clamp(finite(o.alpha, 1), 0, 1),
        };
        return 0;
      });
      api('clear_hud', () => { overlay.hud = undefined; return 0; });
      api('clear', () => {
        clearOverlay(overlay);
        return 0;
      });
      api('display', (L: any) => {
        const props = readValue(L, 1);
        if (!isObject(props)) { overlay.display = {}; return 0; }
        const display = { ...overlay.display };
        if (typeof props.score === 'number' && Number.isFinite(props.score)) display.score = clamp(props.score, 0, 1e9);
        if (typeof props.combo === 'string') display.combo = props.combo.slice(0, 128);
        if (typeof props.level === 'string') display.level = props.level.slice(0, 128);
        if (typeof props.progress === 'number' && Number.isFinite(props.progress)) display.progress = clamp(props.progress, 0, 1);
        overlay.display = display;
        return 0;
      });
      api('screen', (L: any) => {
        const color = readColor(readValue(L, 1));
        overlay.screen = color ? { color, alpha: clamp(finite(readValue(L, 2), 1), 0, 1) } : undefined;
        return 0;
      });
      api('volume', (L: any) => { overlay.musicVolume = clamp(finite(readValue(L, 1), 1), 0, 1); return 0; });
      api('loop', (L: any) => {
        const name = lua.lua_tojsstring(L, 1);
        if (name === null || name.length > 256) return 0;
        if (lua.lua_isnoneornil(L, 2)) { overlay.loops.delete(name); return 0; }
        if (overlay.loops.size < 16 || overlay.loops.has(name)) overlay.loops.set(name, {
          volume: clamp(finite(readValue(L, 2), 0), 0, 1), rate: clamp(finite(readValue(L, 3), 1), .1, 4),
        });
        return 0;
      });
      api('element', (L: any) => {
        const id = lua.lua_tojsstring(L, 1);
        if (id === null || id.length > 128) return 0;
        const props = readValue(L, 2);
        if (!isObject(props)) { overlay.elements.delete(id); return 0; }
        if (!overlay.elements.has(id) && overlay.elements.size >= 256) return 0;
        const old = overlay.elements.get(id);
        const value = (key: keyof ScriptElement, fallback: number, min: number, max: number) =>
          clamp(finite(props[key], finite(old?.[key], fallback)), min, max);
        const string = (key: 'texture' | 'text' | 'action', max: number) =>
          typeof props[key] === 'string' ? (props[key] as string).slice(0, max) : old?.[key];
        overlay.elements.set(id, {
          x: value('x', .5, -10, 10), y: value('y', .5, -10, 10),
          width: value('width', .1, 0, 10), height: value('height', .1, 0, 10),
          size: value('size', .03, .005, 1), rotation: value('rotation', 0, -36000, 36000),
          alpha: value('alpha', 1, 0, 1), color: readColor(props.color) ?? old?.color,
          texture: string('texture', 256), text: string('text', 512), action: string('action', 128),
        });
        return 0;
      });
      api('chart', (L: any) => {
        const name = lua.lua_tojsstring(L, 1);
        if (name !== null && name.length <= 128) actions.push({ type: 'chart', name });
        return 0;
      });
      api('finish', () => { actions.push({ type: 'finish' }); return 0; });
      api('sound', (L: any) => {
        const name = lua.lua_tojsstring(L, 1);
        if (name !== null && name.length <= 256) actions.push({ type: 'sound', name, volume: clamp(finite(readValue(L, 2), 1), 0, 1) });
        return 0;
      });
      api('pause', () => { actions.push({ type: 'pause' }); return 0; });
      api('play', () => { actions.push({ type: 'play' }); return 0; });
      api('seek', (L: any) => {
        const time = lua.lua_tonumberx(L, 1);
        if (Number.isFinite(time)) actions.push({ type: 'seek', time });
        return 0;
      });
      lua.lua_setglobal(L, 'pwp');

      lua.lua_sethook(L, (_L: any) => {
        guard.used += COUNT_HOOK;
        if (guard.used > guard.limit) {
          guard.limit = Infinity;
          lauxlib.luaL_error(_L, core.to_luastring('脚本触发指令预算上限'));
        }
      }, lua.LUA_MASKCOUNT, COUNT_HOOK);
    } catch (error) {
      report(`Lua 沙箱初始化失败：${error instanceof Error ? error.message : error}`);
    }
  }

  const call = (name: string, args: (L: any) => number, results: number, limit: number): unknown[] => {
    if (!L || disposed) return [];
    lua.lua_settop(L, 0);
    lua.lua_getglobal(L, name);
    if (lua.lua_type(L, -1) !== lua.LUA_TFUNCTION) { lua.lua_pop(L, 1); return []; }
    guard.used = 0;
    guard.limit = limit;
    try {
      const status = lua.lua_pcall(L, args(L), results, 0);
      if (status !== lua.LUA_OK) {
        const message = lua.lua_tojsstring(L, -1) ?? '未知错误';
        lua.lua_pop(L, 1);
        report(`${name}：${message}`);
        return [];
      }
      return Array.from({ length: results }, (_, index) => readValue(L, index - results));
    } catch (error) {
      report(`${name}：${error instanceof Error ? error.message : error}`);
      return [];
    } finally {
      guard.limit = 0;
      lua.lua_settop(L, 0);
    }
  };

  const stateArgs = (state: ScriptState) => (L: any) => { pushValue(L, { ...state }); return 1; };
  const noteValue = (note: ScriptNote) => ({ ...note });
  const hookArgs = (note: ScriptNote, grade: ScriptGrade, state: ScriptState) => (L: any) => {
    pushValue(L, noteValue(note));
    lua.lua_pushliteral(L, grade);
    pushValue(L, { ...state });
    return 3;
  };

  // Loading is safe even when a script is broken: the error is recorded and
  // the chart still plays without scripts.
  if (L) for (const script of scripts) {
    if (disposed) break;
    if (script.source.length > MAX_SCRIPT_SIZE) { report(`${script.name}：脚本超过 ${MAX_SCRIPT_SIZE} 字节`); break; }
    lua.lua_settop(L, 0);
    const status = lauxlib.luaL_loadstring(L, core.to_luastring(script.source));
    if (status !== lua.LUA_OK) {
      report(`${script.name}：${lua.lua_tojsstring(L, -1) ?? '编译失败'}`);
      lua.lua_settop(L, 0);
      break;
    }
    guard.used = 0; guard.limit = BUDGET.load;
    const result = lua.lua_pcall(L, 0, 0, 0);
    guard.limit = 0;
    if (result !== lua.LUA_OK) {
      report(`${script.name}：${lua.lua_tojsstring(L, -1) ?? '执行失败'}`);
      lua.lua_settop(L, 0);
      break;
    }
    lua.lua_settop(L, 0);
  }
  ready = !!L && errors.length === 0;

  return {
    overlay, errors, logs,
    get ready() { return ready; },
    load(state) {
      if (loaded) return;
      loaded = true;
      call('on_load', stateArgs(state), 0, BUDGET.reset);
    },
    reset(state) {
      // The runtime loads a chart and immediately performs its initial judge
      // reset. Keep overlays created by on_load for that first reset; later
      // restarts and seeks must not inherit stale HUD or note styles.
      if (resets++ > 0) {
        clearOverlay(overlay);
      }
      actions.length = 0;
      finished = false;
      call('on_reset', stateArgs(state), 0, BUDGET.reset);
    },
    update(dt, state) {
      if (finished || !Number.isFinite(dt)) return;
      const seconds = Math.max(0, Math.min(.25, dt));
      call('on_update', (L: any) => {
        lua.lua_pushnumber(L, seconds);
        pushValue(L, { ...state });
        return 2;
      }, 0, BUDGET.update);
    },
    judge(note, grade, state) {
      if (finished) return grade;
      const input = noteValue(note);
      const result = call('on_judge', hookArgs(input, grade, state), 1, BUDGET.judge);
      return typeof result[0] === 'string' && grades.has(result[0] as ScriptGrade) ? result[0] as ScriptGrade : grade;
    },
    hit(note, grade, state) {
      if (finished) return;
      call('on_hit', hookArgs(noteValue(note), grade, state), 0, BUDGET.judge);
    },
    finish(state) {
      if (finished) return;
      finished = true;
      call('on_finish', stateArgs(state), 0, BUDGET.finish);
    },
    action(name, state) {
      if (finished) return;
      call('on_action', (L: any) => { pushValue(L, name); pushValue(L, { ...state }); return 2; }, 0, BUDGET.judge);
    },
    pointer(x, y, state) {
      if (finished || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      for (const element of [...overlay.elements.values()].reverse()) {
        if (!element.action || element.alpha <= 0) continue;
        const angle = -element.rotation * Math.PI / 180;
        const dx = (x - element.x) * (state.width ?? 1), dy = (y - element.y) * (state.height ?? 1);
        const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
        const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
        if (Math.abs(localX) > element.width * (state.width ?? 1) / 2 || Math.abs(localY) > element.height * (state.height ?? 1) / 2) continue;
        this.action(element.action, state);
        return true;
      }
      return false;
    },
    takeActions() { return actions.splice(0); },
    dispose() {
      disposed = true;
      actions.length = 0;
      clearOverlay(overlay);
      if (L) { try { lua.lua_close(L); } catch { /* already closed */ } }
    },
  };
}
