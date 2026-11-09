import { expect, it } from 'vitest';
import { phigrosEase, phigrosEaseToRpe } from '../../../src/chart/formats/phi';

function nativeReference(progress: number, type: number): number {
  const sample = (p: number) => {
    if(type===13)return 0;if(type===14)return 1;
    if(type<1||type>12)return p;
    const n=Math.floor((type-1)/3)+2,kind=(type-1)%3;
    return kind===0?Math.pow(p,n):kind===1?1-Math.pow(1-p,n):p<.5?.5*Math.pow(2*p,n):1-.5*Math.pow(2-2*p,n);
  };
  const row=Float32Array.from({length:101},(_,i)=>sample(i/100));
  if(progress<=0)return row[0];if(progress>=1)return row[100];
  const scaled=progress*100,i=Math.floor(scaled);return row[i]+(scaled-i)*(row[i+1]-row[i]);
}
it('maps actual BlockArea functions rather than misleading native enum names',()=>{
  expect([...phigrosEaseToRpe]).toEqual([1,5,4,7,9,8,12,11,10,13,15,14]);
  expect(phigrosEase(.5,1)).toBe(.25);expect(phigrosEase(.5,4)).toBe(.125);
});
it.each(Array.from({length:15},(_,i)=>i))('preserves all 1%% Float32 samples and interpolation for native type %s',type=>{
  for(let i=0;i<=1000;i++)expect(phigrosEase(i/1000,type)).toBe(nativeReference(i/1000,type));
  expect(phigrosEase(-2,type)).toBe(nativeReference(-2,type));expect(phigrosEase(2,type)).toBe(nativeReference(2,type));
});
it('keeps Zero/One boundaries and unknown-enum linear fallback',()=>{
  for(const p of [0,.001,.5,1]){expect(phigrosEase(p,13)).toBe(0);expect(phigrosEase(p,14)).toBe(1);}
  expect(phigrosEase(.123,99)).toBe(nativeReference(.123,99));
});
