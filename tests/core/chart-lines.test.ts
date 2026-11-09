import { expect, it } from 'vitest';
import { lineVisualKind, orderedLines, rpeLineSize } from '../../src/core/chart-lines';
import { chartViewport } from '../../src/core/chart-viewport';
import { parseChart } from '../../src/library/importer';
import { lineAppearance } from '../../src/core/chart-state';

const b = (n: number) => [n, 0, 1];
const chart = (lines: unknown[]) => parseChart({ META: {}, BPMList: [{ startTime: b(0), bpm: 120 }], judgeLineList: lines });
it('uses 4000 by 5 RPE pixels at all viewport sizes without Phigros height-based line sizing', () => {
  for (const [w,h] of [[960,540],[1920,1080],[1200,900],[1080,1920]]) {
    const vp = chartViewport(w,h,1.5), size = rpeLineSize(vp.textureScale);
    expect(size.halfLength).toBeCloseTo(2000*vp.width/1350);
    expect(size.width).toBeCloseTo(5*vp.width/1350);
  }
  expect(rpeLineSize(.6)).toEqual({halfLength:1200,width:3});
  expect(rpeLineSize(.6,-.5,-2)).toEqual({halfLength:-600,width:6});
});
it('sorts negative layer textures behind text, preserves tied order and excludes attachUI', () => {
  const data = chart([{ extended:{textEvents:[{startTime:b(0),endTime:b(1),start:'Text',end:'Text'}]} },
    {zOrder:-100,Texture:'anim.gif'}, {zOrder:1}, {attachUI:'score'}, {zOrder:0}]);
  expect(orderedLines(data.judgeLineList)).toEqual([data.judgeLineList[1],data.judgeLineList[0],data.judgeLineList[4],data.judgeLineList[2]]);
  expect(data.judgeLineList[0].animation?.zOrder).toBe(0);
});
it('never turns a text line into a texture or ordinary line before, between or after text events', () => {
  const line = chart([{Texture:'omitted.gif',extended:{textEvents:[
    {startTime:b(2),endTime:b(3),start:'Text',end:'Text'},
    {startTime:b(4),endTime:b(5),start:'',end:''},
  ]}}]).judgeLineList[0];
  for(const time of [-1,0,1,1.75,2,100])expect(lineVisualKind(line)).toBe('text');
  expect(lineAppearance(line,0).text).toBe('');expect(lineAppearance(line,1.2).text).toBe('Text');
  expect(lineAppearance(line,3).text).toBe('');expect(line.animation?.texture).toBeUndefined();
});
