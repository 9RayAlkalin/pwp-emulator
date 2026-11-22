import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createScriptHost, type ScriptState } from '../../../src/chart/script/lua';
import { Spectrum } from '../../../src/audio/spectrum';

const state = (time = 0, overrides: Partial<ScriptState> = {}): ScriptState => ({
  time, duration: 200, playing: true, progress: time / 200, score: 0, accuracy: 100,
  combo: 0, maxCombo: 0, perfect: 0, good: 0, bad: 0, miss: 0, total: 1000,
  width: 1600, height: 900, spectrum: 0, ...overrides,
});
const host = (name: string) => {
  const source = readFileSync(new URL(`../../../assets/scripts/april251/${name}.lua`, import.meta.url), 'utf8');
  return createScriptHost([{ name: 'setup', source: 'remote_parts = {}' }, { name, source }]);
};

it('reconstructs the 305-note display, 0.8 s reveal and judgement faces without changing scoring', () => {
  const h = host('yukifuri'); h.load(state()); h.reset(state());
  h.update(.016, state(50, { perfect: 100, maxCombo: 100 }));
  expect(h.overlay.display.score).toBe(327869);
  expect(h.overlay.display.progress).toBeCloseTo(50 / 112.9485);
  expect(h.overlay.display.level).toBe('lN  Lv.I2');
  h.update(.016, state(86.95385, { perfect: 305, maxCombo: 305 }));
  expect(h.overlay.display.score).toBe(305000);
  expect(h.overlay.display.level).toBe('SP  Lv.?');
  h.update(.016, state(167.17943));
  expect(h.overlay.display.combo).toBe('(⊙o⊙)');
  h.hit({ id: '1:1', line: 1, index: 1, type: 'tap', time: 167.2, holdTime: 0, x: .5, speed: 1, above: true, fake: false }, 'good', state(167.2));
  h.update(.016, state(167.2));
  expect(h.overlay.display.combo).toBe('(＾ω＾)');
  h.update(.016, state(184)); expect(h.overlay.display.combo).toBe('');
  h.reset(state()); expect(h.overlay.display.combo).toBe(''); expect(h.errors).toEqual([]);
});

it('drives Yukifuri progress with the recovered native spectrum gain instead of an under-scaled FFT', () => {
  const samples = Float32Array.from({ length:8192 }, (_,i)=>.4*Math.sin(2*Math.PI*32*i/8192));
  const audio = {sampleRate:8192,getChannelData:()=>samples} as unknown as AudioBuffer;
  const h=host('yukifuri');h.load(state());h.reset(state());
  h.update(.016,state(120,{spectrum:new Spectrum(audio).meanSquare(1)}));
  const meanSquare=(.4/2*2.5)**2/4096+(8192*Math.fround(1e-8)*2.5)**2/4096;
  const energy=Math.min(1,Math.log10(1+9*Math.sqrt(meanSquare))*16);
  const expected=Math.max(0,Math.min(1,1.3/(1+2.7182817459106445**(2-6*energy))-.15));
  expect(h.overlay.display.progress).toBeCloseTo(expected,7);
  expect(h.errors).toEqual([]);
});

it('hides the silent Yukifuri bar without changing the opening progress or audible response', () => {
  const h = host('yukifuri'); h.load(state()); h.reset(state());
  h.update(.016, state(50, { spectrum: 0 }));
  expect(h.overlay.display.progress).toBeCloseTo(50 / 112.9485);
  h.update(.016, state(226.45, { spectrum: 1.0396772421568434e-11 }));
  expect(h.overlay.display.progress).toBe(0);
  h.update(.016, state(226.46, { spectrum: 1e-6 }));
  expect(h.overlay.display.progress).toBeGreaterThan(0);
});

it('gates the native remote by power, mode and a 0.3 s cooldown, then switches at 0°C', () => {
  const h = host('superhot'); h.load(state()); h.reset(state());
  h.action('controller', state(1)); h.action('minus', state(1)); h.update(0, state(1));
  expect(h.overlay.display.level).toContain('26°C');
  h.action('power', state(1)); h.action('mode', state(1.31));
  h.action('minus', state(1.62)); h.update(0, state(1.62));
  const first = h.overlay.display.level;
  h.action('minus', state(1.63)); h.update(0, state(1.63)); expect(h.overlay.display.level).toBe(first);
  let now = 2;
  for (let i = 0; i < 300 && !h.overlay.display.level?.includes('  0°C'); i++) {
    now += .31; h.action('minus', state(now)); h.update(.25, state(now));
    expect(h.errors).toEqual([]);
  }
  expect(h.overlay.display.level).toContain('  0°C');
  h.takeActions(); h.update(.25, state(now + 7.1));
  expect(h.takeActions()).toEqual([{ type: 'chart', name: 'SP' }]);
  h.reset(state()); h.update(0, state()); expect(h.overlay.display.level).toContain('26°C');
});

it('uses the 16°C floor outside cooling mode and ends the hot route after seven seconds', () => {
  const h = host('superhot'); h.load(state()); h.reset(state()); h.action('power', state());
  for (let i = 1; i <= 120; i++) { h.action('minus', state(i)); h.update(.25, state(i)); }
  expect(Number(h.overlay.display.level?.match(/(\d+)°C/)?.[1])).toBeGreaterThanOrEqual(16);
  let now = 121;
  for (; now < 500 && !h.overlay.display.level?.includes('40°C'); now++) { h.action('plus', state(now)); h.update(.25, state(now)); }
  expect(h.overlay.display.level).toContain('40°C'); h.takeActions();
  h.update(.25, state(now + 7)); expect(h.takeActions()).toEqual([{ type: 'finish' }]);
});

it('hit tests rotated buttons in canvas pixels and clears them, pending actions and volume on reset', () => {
  const h = createScriptHost([{ name: 'controls', source: `
    function on_load(s)
      pwp.element('b',{x=.5,y=.5,width=.2,height=.1,rotation=90,action='go'})
      pwp.screen('#ff0000',.5);pwp.volume(.4)
    end
    function on_action(a,s) if a=='go' then pwp.chart('SP') end end
  ` }]); h.load(state()); h.reset(state());
  expect(h.pointer(.5, .65, state())).toBe(true);
  expect(h.pointer(.6, .5, state())).toBe(false);
  expect(h.takeActions()).toEqual([{ type: 'chart', name: 'SP' }]);
  h.pointer(.5,.5,state()); h.reset(state());
  expect(h.overlay.elements.size).toBe(0); expect(h.overlay.musicVolume).toBe(1);
  expect(h.overlay.screen).toBeUndefined(); expect(h.takeActions()).toEqual([]);
});

it('bounds the reconstructed emitter after a large time jump and clears it on restart', () => {
  const source = readFileSync(new URL('../../../assets/scripts/april251/particles.lua', import.meta.url), 'utf8');
  const h = createScriptHost([{ name: 'particles', source }, { name: 'driver', source: `
    function on_reset(s) april_particles_reset() end
    function on_update(dt,s) april_particles(s,true,false) end
  ` }]); h.load(state()); h.reset(state());
  h.update(.016, state(100)); expect(h.overlay.elements.size).toBeLessThanOrEqual(26);
  expect([...h.overlay.elements.values()].every(e=>Number.isFinite(e.x)&&e.alpha>=0&&e.alpha<=1)).toBe(true);
  h.reset(state()); expect(h.overlay.elements.size).toBe(0); expect(h.errors).toEqual([]);
});
