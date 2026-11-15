import { expect, it } from 'vitest';
import { parseChart } from '../../../src/chart/import/importer';
import { parseRpen } from '../../../src/chart/formats/rpen';
import { blockingNoiseAt, projectNoise, sampleNoise, shaderValues } from '../../../src/gameplay/noise';

const b = (x: number) => [x,0,1];
const event = (start: number, end: number, from=0, to=4, extra={}) => ({ startTime:b(from),endTime:b(to),start,end,easingType:1,...extra });
const area = (extra={}) => ({ bottomLeft:{x:90,y:-10},topRight:{x:110,y:10},appearTime:b(0),disappearTime:b(20),
  activeIntervals:[{startTime:b(4),endTime:b(8),readyFlash:.5}],...extra });
const chart = (extra={}) => ({ META:{RPEVersion:230,offset:150},BPMList:[{startTime:b(0),bpm:120}],
  judgeLineList:[{eventLayers:[],notes:[{type:1,startTime:b(2),isFake:1}]}],blockAreaList:[area()],...extra });

it('dispatches RPEN independently, preserves notes and never converts its regions to native blocks',()=>{
  const raw=chart(),copy=structuredClone(raw),data=parseChart(raw);
  expect(data.sourceFormat).toBe('rpen');expect(data.offset).toBe(.15);
  expect(data.judgeLineList[0].notesAbove[0]).toMatchObject({time:1,isFake:true});
  expect(data.rpen!.areas[0]).toMatchObject({appear:0,disappear:10,center:{x:100,y:0},size:{x:20,y:20}});
  expect(data.blockAreaList).toBeUndefined();expect(raw).toEqual(copy);
  expect(parseChart(raw,'rpe').sourceFormat).toBe('rpe');
  expect(parseChart({...raw,META:{},blockAreaList:undefined},'rpen').sourceFormat).toBe('rpen');
  expect(parseChart({META:{RPEVersion:170},BPMList:raw.BPMList,judgeLineList:raw.judgeLineList}).sourceFormat).toBe('rpe');
});
it('uses seconds for readyFlash, clips activation to lifetime, and has half-open boundaries',()=>{
  const a=parseRpen(chart()).rpen!.areas[0];
  expect([-.1,0,1.49,1.5,2,3.99,4,10].map(t=>sampleNoise(a,t).state))
    .toEqual(['hidden','disabled','disabled','ready','active','active','disabled','hidden']);
  const clipped=parseRpen(chart({blockAreaList:[area({appearTime:b(5),disappearTime:b(7)})]})).rpen!.areas[0];
  expect(clipped.active[0]).toEqual({start:2.5,end:3.5,ready:.5});
});
it('uses scale values for size even when a zero scale baseline cannot move the center',()=>{
  const a=parseRpen(chart({blockAreaList:[area({scaleXEvents:[event(0,2,0,4,{anchor:{x:0,y:0}})]})]})).rpen!.areas[0];
  const s=sampleNoise(a,1);
  expect(s.points.map(p=>p.x)).toEqual([90,110,110,90]);
  const end=sampleNoise(a,2);expect(end.points.map(p=>p.x)).toEqual([80,120,120,80]);
});
it('accumulates anchor changes, scale resets, rotation and absolute move deltas without frame history',()=>{
  const a=parseRpen(chart({blockAreaList:[area({
    scaleXEvents:[event(1,2,0,2,{anchor:{x:0,y:0}}),event(1,3,2,4,{anchor:{x:50,y:0}})],
    rotateEvents:[event(0,90,0,4,{anchor:{x:0,y:0}})],moveXEvents:[event(100,110)],
  })]})).rpen!.areas[0];
  const last=sampleNoise(a,2),center=last.points.reduce((p,n)=>({x:p.x+n.x/4,y:p.y+n.y/4}),{x:0,y:0});
  // At 2s, center is scaled to 200 (first anchor), reset to 100,
  // scaled around x=50 to 200, then rotated clockwise 90° and moved +10.
  expect(center.x).toBeCloseTo(10);expect(center.y).toBeCloseTo(-200);
  sampleNoise(a,.25);expect(sampleNoise(a,2)).toEqual(last);
});
it('does not multiply regions by a line bpmfactor and samples cross-BPM shader spans in seconds',()=>{
  const raw=chart({BPMList:[{startTime:b(0),bpm:120},{startTime:b(2),bpm:60}],
    judgeLineList:[{bpmfactor:2,eventLayers:[],notes:[]}],
    effects:[{shader:'vignette',line:0,global:false,start:b(0),end:b(4),vars:{extend:[event(0,1)],color:[1,0,0,1]}}]});
  const d=parseRpen(raw).rpen!,e=d.effects[0];
  expect(d.areas[0].active[0]).toMatchObject({start:3,end:7});expect(e.end).toBe(6);
  expect(shaderValues(e,3)).toEqual({extend:.5,color:[1,0,0,1]});
});
it('takes embedded effects once, falls back to extra.json, preserves defaults before a parameter starts',()=>{
  const effect={shader:'glitch',line:0,global:true,order:2,start:b(0),end:b(8),vars:{power:[event(.1,0,2,4)]}};
  const embedded=parseRpen(chart({effects:[effect]}),{effects:[effect]}).rpen!;
  expect(embedded.effects).toHaveLength(1);expect(shaderValues(embedded.effects[0],.5)).toEqual({});
  expect(shaderValues(embedded.effects[0],1.5).power).toBeCloseTo(.05);
  expect(parseRpen(chart(),{effects:[effect]}).rpen!.effects).toHaveLength(1);
});
it('preserves vector uniform tracks and stable ordering without treating owner line as a render target',()=>{
  const e={shader:'custom.glsl',line:0,start:b(0),end:b(8),vars:{color:[event([0,0,0,1] as any,[1,.5,.25,1] as any)]}};
  const effects=parseRpen(chart({effects:[{...e,order:3},{...e,global:true,order:1}]})).rpen!.effects;
  expect(effects.map(e=>e.order)).toEqual([1,3]);expect(shaderValues(effects[0],1).color).toEqual([.5,.25,.125,1]);
});
it.each([
  {noiseAreaLayers:[{id:'x',skin:''}]},
  {noiseAreaLayers:[{id:'default',skin:''},{id:'default',skin:''}]},
  {blockAreaList:[area({disappearTime:b(-1)})]},
  {blockAreaList:[area({scaleXEvents:[event(1,2,0,4,{easingType:30})]})]},
  {effects:[{shader:'glitch',start:b(2),end:b(1),vars:{}}]},
  {effects:[{shader:'glitch',start:b(0),end:b(1),vars:{power:[event(0,1,0,1,{customEasing:{}})]}}]},
])('rejects malformed RPEN extensions instead of silently dropping them: %j',extra=>{
  expect(()=>parseRpen(chart(extra))).toThrow();
});

it('merges identical activation starts without losing a longer active duration',()=>{
  const a=parseRpen(chart({blockAreaList:[area({activeIntervals:[
    {startTime:b(4),endTime:b(8),readyFlash:.2},{startTime:b(4),endTime:b(6),readyFlash:1},
  ]})]})).rpen!.areas[0];
  expect(a.active).toEqual([{start:2,end:4,ready:1}]);expect(sampleNoise(a,3.5).state).toBe('active');
});
it('does not create a ready flash from a nonzero activation clipped entirely outside the lifetime',()=>{
  const a=parseRpen(chart({blockAreaList:[area({activeIntervals:[{startTime:b(20),endTime:b(24),readyFlash:1}]})]})).rpen!.areas[0];
  expect(a.active).toEqual([]);expect(sampleNoise(a,9.5).state).toBe('disabled');
  const zero=parseRpen(chart({blockAreaList:[area({activeIntervals:[{startTime:b(10),endTime:b(10),readyFlash:1}]})]})).rpen!.areas[0];
  expect(sampleNoise(zero,4.5).state).toBe('ready');expect(sampleNoise(zero,5).state).toBe('disabled');
});
it('blocks only active layer coverage, handles inverted overlap count, and keeps layers independent',()=>{
  const a=parseRpen(chart()).rpen!.areas[0],inv={...a,invert:true};
  expect(blockingNoiseAt([a],1.8,100,0)).toBeUndefined();
  expect(blockingNoiseAt([a],2.5,100,0)).toBe(a);expect(blockingNoiseAt([a],2.5,130,0)).toBeUndefined();
  expect(blockingNoiseAt([a,inv],2.5,100,0)).toBeUndefined();
  expect(blockingNoiseAt([inv],2.5,100,0)).toBe(inv);
  expect(blockingNoiseAt([inv,inv],2.5,100,0)).toBeUndefined();
  expect(blockingNoiseAt([inv,inv,inv],2.5,100,0)).toBeUndefined();
  expect(blockingNoiseAt([a,{...inv,layer:'second'}],2.5,100,0)).toBeTruthy();
});

it.each([[1440,1080],[1920,1080],[1080,1440]])('projects a rotated area on %sx%s without shearing its angle or touch geometry',(width,height)=>{
  const a=parseRpen(chart({blockAreaList:[area({rotateEvents:[event(30,30,0,4,{anchor:{x:100,y:0}})]})]})).rpen!.areas[0];
  const projected=projectNoise(sampleNoise(a,2.5),width,height),edge={x:projected.points[1].x-projected.points[0].x,y:projected.points[1].y-projected.points[0].y};
  expect(Math.atan2(edge.y,edge.x)).toBeCloseTo(-Math.PI/6);expect(Math.hypot(edge.x,edge.y)).toBeCloseTo(20*width/1350);
  expect(projected.center.x).toBeCloseTo(100*width/1350);expect(blockingNoiseAt([a],2.5,projected.center.x,0,width,height)).toBe(a);
});
