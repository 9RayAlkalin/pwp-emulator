import type { ChartEvent, ChartLine } from '../types';
import { eventValue, get_event_val } from './timeline';
import { easingProgress } from './chart-easing';
import { defaultChartAspect } from './chart-viewport';

export type LineState = [rotation: number, x: number, y: number, alpha: number];
const value = (t: number, events?: ChartEvent[], fallback = 0) => events?.length ? get_event_val(t, events, 'start', 'end') : fallback;
const sum = (t: number, layers: ChartEvent[][]) => layers.reduce((total, events) => total + value(t, events), 0);

export function createLineStateResolver(lines: ChartLine[], aspectRatio: number | (() => number) = defaultChartAspect) {
  const cache = new Map<ChartLine, LineState>();
  let lastTime = NaN, lastAspect = NaN;
  return function state(line: ChartLine, time: number): LineState {
    const aspect = typeof aspectRatio === 'function' ? aspectRatio() : aspectRatio;
    if (lastTime !== time || lastAspect !== aspect) { cache.clear(); lastTime = time; lastAspect = aspect; }
    const cached = cache.get(line);
    if (cached) return cached;
    const a = line.animation;
    let result: LineState;
    if (a) {
      let x = sum(time, a.x), y = sum(time, a.y), rotation = sum(time, a.rotation);
      if (a.father !== undefined && a.father >= 0) {
        const [angle, px, py] = state(lines[a.father], time);
        const rad = angle * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
        const dx = x * cos + y / aspect * sin;
        y = -x * aspect * sin + y * cos;
        x = dx + px - .5; y += .5 - py;
        if (a.rotateWithFather) rotation += angle;
      }
      result = [rotation, x + .5, .5 - y, sum(time, a.alpha)];
    } else {
      const tick = time * line.bpm / (60 / 32);
      result = [-value(tick, line.judgeLineRotateEvents),
        value(tick, line.judgeLineMoveEvents),
        1 - (line.judgeLineMoveEvents.length ? get_event_val(tick, line.judgeLineMoveEvents, 'start2', 'end2') : 0),
        value(tick, line.judgeLineDisappearEvents)];
    }
    cache.set(line, result);
    return result;
  };
}

export function lineAppearance(line: ChartLine, time: number) {
  const a = line.animation;
  let text: string | undefined;
  if (a?.text?.length) {
    text = '';
    for (const e of a.text) {
      if (time < e.startTime) break;
      const progress = easingProgress(e.endTime === e.startTime ? 1 : (time - e.startTime) / (e.endTime - e.startTime), e.easing ?? { type: 1 });
      const number = /^(-?\d+(?:\.\d+)?)%P%$/;
      if (number.test(e.start) && number.test(e.end)) {
        text = String(Math.round(Number(e.start.replace('%P%', '')) + progress * (Number(e.end.replace('%P%', '')) - Number(e.start.replace('%P%', '')))));
      } else if (e.end.startsWith(e.start)) text = e.end.slice(0, Math.round(e.start.length + progress * (e.end.length - e.start.length)));
      else if (e.start.startsWith(e.end)) text = e.start.slice(0, Math.round(e.start.length + progress * (e.end.length - e.start.length)));
      else text = time >= e.endTime ? e.end : e.start;
      if (time < e.endTime) break;
    }
  }
  const gif = a?.gif?.find(e => time >= e.startTime && time < e.endTime);
  return { scaleX: value(time, a?.scaleX, 1), scaleY: value(time, a?.scaleY, 1),
    color: a?.color?.length ? `rgb(${a.color.map(events => Math.round(Math.max(0, Math.min(255, value(time, events, 255))))).join(',')})` : undefined,
    text, gifProgress: gif ? eventValue(time, gif) : undefined };
}
