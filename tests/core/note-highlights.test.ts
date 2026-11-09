import { expect, it } from 'vitest';
import { noteHighlights } from '../../src/core/note-highlights';
import { Judge } from '../../src/core/judge';
import { parseChart } from '../../src/library/importer';
import type { RuntimeNote } from '../../src/types';

it('counts real/fake and fake/fake RPE simultaneous notes for visual highlighting',()=>{
  expect(noteHighlights([{sect:1,isFake:true},{sect:1},{sect:2,isFake:true}],'rpe')).toEqual([true,true,false]);
  expect(noteHighlights([{sect:1,isFake:true},{sect:1,isFake:true}],'rpe')).toEqual([true,true]);
});
it('uses RPEN microsecond buckets without grouping distinct instants or expanding to Hold duration overlaps',()=>{
  expect(noteHighlights([{sect:1.00000001},{sect:1.00000002,isFake:true},{sect:1.00001}],'rpe')).toEqual([true,true,false]);
  expect(noteHighlights([{sect:1},{sect:1.5}],'rpe')).toEqual([false,false]);
});
it('honours explicit off/auto/forced highlights without counting disabled notes',()=>{
  expect(noteHighlights([{sect:1,highlight:0},{sect:1,highlight:1},{sect:2,highlight:2,isFake:true}],'rpe')).toEqual([false,false,true]);
  expect(noteHighlights([{sect:1,highlight:2},{sect:1,isFake:true}],'rpe')).toEqual([true,true]);
});
it('keeps existing Phigros/PEC fake exclusion and exact-time matching',()=>{
  for(const format of ['phigros','pec'] as const){
    expect(noteHighlights([{sect:1,isFake:true},{sect:1},{sect:2},{sect:2} ],format)).toEqual([false,false,true,true]);
    expect(noteHighlights([{sect:1.00000001},{sect:1.00000002}],format)).toEqual([false,false]);
  }
});
it('never promotes visually highlighted fake notes into judgement or score',()=>{
  const base={type:1 as const,time:1,holdTime:0,positionX:0,speed:1,sect:1,secht:0,hold_end_time:1,is_hold:false,is_above:true,clicked:false,
    master:{get_state:()=>[0,.5,.5,1]}};
  const notes:RuntimeNote[]=[{...base,isFake:true},{...base}];expect(noteHighlights(notes,'rpe')).toEqual([true,true]);
  const judge=new Judge();judge.reset(notes);expect(judge.stats.total).toBe(1);judge.input('key',0,0,'tap',1,1000,500,true);
  expect(judge.stats.perfect).toBe(1);expect(judge.results.has(notes[0])).toBe(false);expect(judge.hitEffects).toHaveLength(1);
});
it('preserves RPE highlight switches and rejects invalid values',()=>{
  const raw={META:{},BPMList:[{startTime:[0,0,1],bpm:60}],judgeLineList:[{notes:[0,1,2].map(highlight=>({type:1,startTime:[1,0,1],highlight}))}]};
  expect(parseChart(raw).judgeLineList[0].notesAbove.map(n=>n.highlight)).toEqual([0,1,2]);
  raw.judgeLineList[0].notes[0].highlight=3;expect(()=>parseChart(raw)).toThrow('highlight');
});
