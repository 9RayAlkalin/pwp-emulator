import type { NoiseArea, RpenEvent, ShaderEffect, ShaderValue } from '../chart/formats/rpen';
import { easingProgress } from '../chart/animation/easing';

export function noiseEvent(events: RpenEvent[], time: number): RpenEvent | undefined {
  let lo = 0, hi = events.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (events[mid].startTime <= time + 1e-9) lo = mid + 1; else hi = mid; }
  return events[lo - 1];
}
export function noiseValue(event: RpenEvent | undefined, time: number, fallback: number): number {
  if (!event) return fallback;
  const p = event.endTime === event.startTime ? 1 : (time - event.startTime) / (event.endTime - event.startTime);
  return event.start + (event.end - event.start) * easingProgress(p, event.easing);
}
type Point = { x: number; y: number };
type Matrix = [number, number, number, number, number, number];
const apply = (m: Matrix, p: Point): Point => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
const multiply = (a: Matrix, b: Matrix): Matrix => {
  const o = apply(a, { x: b[4], y: b[5] });
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], o.x, o.y];
};
function relative(kind: string, from: number, to: number, anchor: Point): Matrix {
  if (kind === 'rotation') {
    const r = (to - from) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [c, -s, s, c, anchor.x*(1-c)-anchor.y*s, anchor.y*(1-c)+anchor.x*s];
  }
  const ratio = from === 0 ? 1 : to / from;
  return kind === 'scaleX' ? [ratio, 0, 0, 1, anchor.x*(1-ratio), 0] : [1, 0, 0, ratio, 0, anchor.y*(1-ratio)];
}
const prefixes = new WeakMap<RpenEvent[], Matrix[]>();
function transformedCenter(events: RpenEvent[], kind: string, center: Point, base: Point, time: number): Point {
  let cached = prefixes.get(events);
  if (!cached) {
    let m = identity(); cached = [];
    for (let i = 0; i < events.length; i++) {
      if (i) {
        const prev = events[i-1], anchor = prev.anchor ?? base, endpoint = prev.transformEnd ?? prev.end;
        m = multiply(relative(kind, prev.transformStart ?? prev.start, endpoint, anchor), m);
        m = multiply(relative(kind, endpoint, events[i].transformStart ?? events[i].start, anchor), m);
      }
      cached.push(m);
    }
    prefixes.set(events, cached);
  }
  const e = noiseEvent(events, time);
  if (!e) return center;
  const i = events.indexOf(e), p = apply(cached[i], center);
  return apply(relative(kind, e.transformStart ?? e.start, noiseValue(e, time, 0), e.anchor ?? base), p);
}

export function sampleNoise(area: NoiseArea, time: number) {
  let state: 'hidden' | 'active' | 'ready' | 'disabled' = 'disabled';
  if (time + 1e-9 < area.appear || time + 1e-9 >= area.disappear) state = 'hidden';
  else {
    const active = area.active.filter(e => e.end > e.start && e.start <= time + 1e-9).at(-1);
    const next = area.active.find(e => e.start > time + 1e-9);
    if (active && time + 1e-9 < active.end) state = 'active';
    else if (next && next.ready > 0 && time + 1e-9 >= next.start - next.ready) state = 'ready';
  }
  const t = area.tracks, base = area.center;
  const v = (key: keyof typeof t, fallback: number) => noiseValue(noiseEvent(t[key], time), time, fallback);
  const sx = v('scaleX', 1), sy = v('scaleY', 1), r = v('rotation', 0)*Math.PI/180;
  let center = transformedCenter(t.scaleX, 'scaleX', base, base, time);
  center = transformedCenter(t.scaleY, 'scaleY', center, base, time);
  center = transformedCenter(t.rotation, 'rotation', center, base, time);
  const x = center.x + v('x', base.x) - base.x, y = center.y + v('y', base.y) - base.y;
  const points = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([dx,dy]) => {
    const px=dx*area.size.x/2*sx, py=dy*area.size.y/2*sy;
    return { x:x+px*Math.cos(r)+py*Math.sin(r), y:y-px*Math.sin(r)+py*Math.cos(r) };
  });
  return { area, state, points, center:{x,y}, rotation:r };
}
export type NoiseSample = ReturnType<typeof sampleNoise>;
// Centres follow the two stage axes. Rectangle dimensions scale along their
// own axes before rotation, preserving the authored angle on non-3:2 stages.
export function projectNoise(sample: NoiseSample, width: number, height: number): NoiseSample {
  const sx=width/1350,sy=height/900,c=Math.cos(sample.rotation),s=Math.sin(sample.rotation);
  const xx=c*c*sx+s*s*sy,xy=c*s*(sy-sx),yy=s*s*sx+c*c*sy;
  const center={x:sample.center.x*sx,y:sample.center.y*sy};
  return {...sample,center,points:sample.points.map(p=>{
    const dx=p.x-sample.center.x,dy=p.y-sample.center.y;
    return{x:center.x+xx*dx+xy*dy,y:center.y+xy*dx+yy*dy};
  })};
}
export function noiseContains(sample: NoiseSample, x: number, y: number): boolean {
  let positive = false, negative = false;
  for (let i = 0; i < 4; i++) {
    const a = sample.points[i], b = sample.points[(i+1)%4];
    const cross = (b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x);
    positive ||= cross > 1e-8; negative ||= cross < -1e-8;
  }
  return positive !== negative;
}
export function blockingNoiseAt(areas: NoiseArea[], time: number, x: number, y: number, width?: number, height?: number): NoiseArea | undefined {
  const layers = new Map<string, { normal?: NoiseArea; inverted: NoiseArea[] }>();
  for (const area of areas) {
    if (time < area.appear || time >= area.disappear) continue;
    let sample = sampleNoise(area,time);
    if(width!==undefined&&height!==undefined)sample=projectNoise(sample,width,height);
    if (sample.state !== 'active' || !noiseContains(sample,x,y)) continue;
    const layer = layers.get(area.layer) ?? { inverted: [] };
    if (area.invert) layer.inverted.push(area); else layer.normal = area;
    layers.set(area.layer,layer);
  }
  for (const layer of layers.values()) if (!!layer.normal !== (layer.inverted.length === 1)) return layer.normal ?? layer.inverted[0];
  return undefined;
}
export function shaderValues(effect: ShaderEffect, time: number): Record<string, ShaderValue> {
  const result: Record<string, ShaderValue> = {};
  for (const [k, v] of Object.entries(effect.vars)) {
    if (!Array.isArray(v) || !Array.isArray(v[0])) { result[k] = v as ShaderValue; continue; }
    const values = (v as RpenEvent[][]).map(events => {
      const e = noiseEvent(events, time); return e ? noiseValue(e, time, 0) : undefined;
    });
    if (values.every((v): v is number => v !== undefined)) result[k] = values.length === 1 ? values[0] : values;
  }
  return result;
}
