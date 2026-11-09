import { expect, it } from 'vitest';
import { chartHoldSpan, chartNoteGeometry } from '../../../src/chart/geometry/notes';
import { parseChart } from '../../../src/chart/import/importer';
import { get_fp, init_speed_events } from '../../../src/chart/animation/timeline';
import { createHitEffect, hitEffectPosition } from '../../../src/gameplay/hits';
import { Judge } from '../../../src/gameplay/judge';
import type { RuntimeNote } from '../../../src/gameplay/types';

const b=(n:number)=>[n,0,1];
const event=(start:number,end=start,from=0,to=4)=>({startTime:b(from),endTime:b(to),start,end,easingType:1});
const parse=(line:unknown,bpms=[{startTime:b(0),bpm:60}])=>parseChart({META:{},BPMList:bpms,judgeLineList:[line]}).judgeLineList[0];
const note={positionX:300/75.9375,speed:.5,type:1 as const};

it('uses unscaled signed distance for Y/size/X/skew controls, then applies note speed exactly once',()=>{
  const line=parse({yControl:[{x:0,y:1,easing:1},{x:100,y:2,easing:1}],
    sizeControl:[{x:0,size:1,easing:1},{x:100,size:.5,easing:1}],
    posControl:[{x:0,pos:1,easing:1},{x:100,pos:2,easing:1}],
    skewControl:[{x:0,skew:0,easing:1},{x:100,skew:.1,easing:1}]});
  const a=chartNoteGeometry(note,line.animation,0,50),c=chartNoteGeometry({...note,speed:2},line.animation,0,50);
  expect(a).toMatchObject({x:450,y:37.5,size:.75,skew:15});
  expect(c).toMatchObject({x:450,y:150,size:.75,skew:15});
  expect(chartNoteGeometry(note,line.animation,0,-20)).toMatchObject({x:300,y:-10,size:1,skew:0});
});
it('projects incline in the line-local X direction with opposite signs above and below',()=>{
  const line=parse({extended:{inclineEvents:[event(30)]}});
  const p=Math.tan((300/675)*30*Math.PI/180)*200*.5;
  expect(chartNoteGeometry(note,line.animation,1,200,true).x).toBeCloseTo(300-p);
  expect(chartNoteGeometry(note,line.animation,1,200,false).x).toBeCloseTo(300+p);
  expect(chartNoteGeometry({...note,positionX:-note.positionX},line.animation,1,200,true).x).toBeCloseTo(-300+p);
  expect(chartNoteGeometry(note,line.animation,1,0).x).toBe(300);
});
it('holds ignore size/X/Y/skew/incline but keep alpha and signed endpoint distances',()=>{
  const line=parse({sizeControl:[{x:0,size:4}],posControl:[{x:0,pos:2}],yControl:[{x:0,y:-2}],
    skewControl:[{x:0,skew:.3}],alphaControl:[{x:0,alpha:.5}],extended:{inclineEvents:[event(60)]}});
  expect(chartNoteGeometry({...note,type:3},line.animation,1,80)).toEqual({x:300,y:40,size:1,skew:0,alpha:.5});
  expect(chartHoldSpan(10,14,12,false)).toEqual([-2,2]);expect(chartHoldSpan(10,14,12,true)).toEqual([0,2]);
  expect(chartHoldSpan(10,14,16,true)).toEqual([0,-2]);
});
it('samples changing incline deterministically and tolerates invalid easing only on constant padding',()=>{
  const line=parse({extended:{inclineEvents:[event(0,30)]}});
  const a=chartNoteGeometry(note,line.animation,1,200);
  expect(chartNoteGeometry(note,line.animation,3,200).x).toBeLessThan(a.x);
  expect(chartNoteGeometry(note,line.animation,1,200)).toEqual(a);
  expect(()=>parse({extended:{inclineEvents:[{...event(0),easingType:47}]}})).not.toThrow();
  expect(()=>parse({extended:{inclineEvents:[{...event(0,30),easingType:47}]}})).toThrow('easingType');
});
it('integrates stop and reverse segments into independent Hold endpoints, without line-speed extrapolation',()=>{
  const line=parse({eventLayers:[{speedEvents:[event(4.5,4.5,0,1),event(0,0,1,2),event(-4.5,-4.5,2,3),event(4.5,4.5,3,4)]}]});
  init_speed_events(line.speedEvents);
  const fp=(t:number)=>get_fp(t,line.speedEvents);
  expect([0,1,2,3,4].map(fp)).toEqual([0,1,1,0,1]);
  expect(chartHoldSpan(fp(.5),fp(3.5),fp(1.5),true)).toEqual([0,-.5]);
  expect(chartHoldSpan(fp(.5),fp(3.5),fp(3),true)).toEqual([0,.5]);
});
it('preserves a linear speed integral across a BPM boundary and backward seeks',()=>{
  const line=parse({eventLayers:[{speedEvents:[event(0,9,0,4)]}]},[{startTime:b(0),bpm:120},{startTime:b(2),bpm:60}]);
  init_speed_events(line.speedEvents);
  // t=0..1 is speed 0..1; t=1..3 is speed 1..2.
  expect(get_fp(3,line.speedEvents)).toBeCloseTo(3.5);
  expect(get_fp(2,line.speedEvents)).toBeCloseTo(1.75);
  expect(get_fp(.5,line.speedEvents)).toBeCloseTo(.125);
});
it('uses the same offset/incline/X/Y projection for manual hit locations and feedback',()=>{
  const line=parse({posControl:[{x:0,pos:1},{x:200,pos:2}],yControl:[{x:0,y:1},{x:200,y:2}],extended:{inclineEvents:[event(30)]}});
  const animation=line.animation!,n:RuntimeNote={type:1,time:1,holdTime:0,positionX:note.positionX,speed:2,yOffset:100/540,
    sect:1,secht:0,hold_end_time:1,is_hold:false,is_above:true,clicked:false,
    master:{animation,get_viewport:()=>({width:1350,gameplayScale:1}),get_state:()=>[0,.5,.5,1]}};
  const p=chartNoteGeometry(n,animation,1,100);
  const [x,y]=hitEffectPosition(createHitEffect(n,1,'perfect'),1350,900);
  expect(x).toBeCloseTo(675+p.x);expect(y).toBeCloseTo(450-p.y);
  const judge=new Judge();judge.reset([n]);judge.input('touch',x,y,'tap',1,1350,900,false);expect(judge.stats.perfect).toBe(1);
});
