import { expect, it } from 'vitest';
import { chartHoldLayout } from '../../../src/chart/geometry/hold';

it.each([1,-1])('joins head/body/tail at exact signed endpoints in direction %s',direction=>{
  const p=chartHoldLayout(direction*150,10,12,true);
  expect(p.direction).toBe(direction);expect(p.tailCenter).toBe(direction*150);
  expect(p.bodyCenter-direction*p.bodyHeight/2).toBeCloseTo(direction*5);
  expect(p.bodyCenter+direction*p.bodyHeight/2).toBeCloseTo(direction*(150-6));
  expect(p.headHeight).toBe(10);expect(p.tailHeight).toBe(12);
});
it.each([1,-1])('anchors active headless Holds at zero while mirroring the tail in direction %s',direction=>{
  const p=chartHoldLayout(direction*150,10,12,false);
  expect(p.headHeight).toBe(0);expect(p.bodyCenter-direction*p.bodyHeight/2).toBeCloseTo(0);
  expect(p.bodyCenter+direction*p.bodyHeight/2).toBeCloseTo(p.tailCenter-direction*p.tailHeight/2);
});
it('hides short tails buried in the unhit head without displaced caps, negative sizes or a zero-length ghost',()=>{
  for(const length of [0,.01,1,3,-.01,-1,-3]){
    const p=chartHoldLayout(length,10,10,true);
    expect(p.bodyHeight).toBeGreaterThanOrEqual(0);expect(p.tailCenter).toBe(length);
    expect(p.headHeight).toBe(10);expect(p.tailHeight).toBe(0);expect(p.bodyHeight).toBe(0);
  }
  expect(chartHoldLayout(0,10,10,false)).toMatchObject({bodyHeight:0,headHeight:0,tailHeight:0});
});
it('keeps the unhit head visible for a zero-speed Hold without stacking a duplicate tail on it',()=>{
  expect(chartHoldLayout(0,10,10,true)).toMatchObject({headHeight:10,bodyHeight:0,tailHeight:0});
});
