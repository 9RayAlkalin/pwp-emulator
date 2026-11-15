import { expect, it } from 'vitest';
import { createScriptHost, type ScriptNote, type ScriptState } from '../../../src/chart/script/lua';

const state = (overrides: Partial<ScriptState> = {}): ScriptState => ({
  time: 1, duration: 10, playing: true, progress: 0.1, score: 100, accuracy: 95,
  combo: 1, maxCombo: 1, perfect: 1, good: 0, bad: 0, miss: 0, total: 2,
  ...overrides,
});

const note: ScriptNote = {
  id: '1:1', line: 1, index: 1, type: 'tap', time: 1, holdTime: 0,
  x: 0.5, speed: 1, above: true, fake: false,
};

it('runs sandboxed hooks and exposes the overlay and action API', () => {
  const host = createScriptHost([{ name: 'main.lua', source: `
    assert(os == nil and io == nil and require == nil and load == nil and dofile == nil)
    function on_load(state)
      pwp.log('load', state.total)
      pwp.hud('Ready', { x = 0.25, y = 0.1, size = 0.08, align = 'left', color = '#ff8000' })
    end
    function on_reset(state)
      pwp.clear()
      pwp.line(1, { color = { 255, 0, 0 }, alpha = 0.5, scale = 2 })
      pwp.note('1:1', { tint = { 0, 255, 0 }, width = 2, visible = true })
      pwp.background({ 0, 0, 0 }, 0.25)
      pwp.seek(3)
    end
    function on_update(dt, state)
      pwp.log('update', dt, state.time)
      pwp.pause()
    end
    function on_judge(note, grade, state)
      if grade == 'miss' then return 'good' end
      return grade
    end
    function on_hit(note, grade, state)
      pwp.log('hit', note.id, grade)
    end
    function on_finish(state)
      pwp.log('finish', state.score)
    end
  ` }]);

  expect(host.ready).toBe(true);
  host.load(state());
  expect(host.logs).toContain('load\t2');
  expect(host.overlay.hud).toMatchObject({ text: 'Ready', x: 0.25, y: 0.1, align: 'left', color: [255, 128, 0] });

  host.reset(state());
  expect(host.overlay.lines.get(1)).toMatchObject({ color: [255, 0, 0], alpha: 0.5, scale: 2 });
  expect(host.overlay.notes.get('1:1')).toMatchObject({ tint: [0, 255, 0], width: 2, visible: true });
  expect(host.overlay.background).toEqual({ color: [0, 0, 0], alpha: 0.25 });
  expect(host.takeActions()).toEqual([{ type: 'seek', time: 3 }]);

  host.update(0.016, state({ time: 1.016 }));
  expect(host.takeActions()).toEqual([{ type: 'pause' }]);
  expect(host.logs).toContain('update\t0.016\t1.016');

  expect(host.judge(note, 'miss', state())).toBe('good');
  expect(host.judge(note, 'perfect', state())).toBe('perfect');
  host.hit(note, 'good', state());
  expect(host.logs).toContain('hit\t1:1\tgood');

  host.finish(state({ score: 999 }));
  expect(host.logs).toContain('finish\t999');
  host.update(1, state());
  expect(host.logs.filter(value => value.startsWith('update\t'))).toHaveLength(1);
  host.finish(state());
  expect(host.logs.filter(value => value.startsWith('finish\t'))).toHaveLength(1);
});

it('keeps on_load overlays through the initial reset and clears them on later resets', () => {
  const host = createScriptHost([{ name: 'hud.lua', source: `
    function on_load(state) pwp.hud('Loaded') end
    function on_reset(state) pwp.log('reset') end
  ` }]);
  host.load(state());
  host.reset(state());
  expect(host.overlay.hud?.text).toBe('Loaded');
  host.reset(state());
  expect(host.overlay.hud).toBeUndefined();
});

it('reports syntax errors and keeps the host playable', () => {
  const host = createScriptHost([{ name: 'broken.lua', source: 'function on_load(' }]);
  expect(host.ready).toBe(false);
  expect(host.errors[0]).toContain('broken.lua');
  expect(() => host.load(state())).not.toThrow();
});

it('stops a runaway loop with the instruction budget', () => {
  const host = createScriptHost([{ name: 'loop.lua', source: `
    function on_update(dt, state)
      while true do end
    end
  ` }]);
  host.update(0.016, state());
  expect(host.errors.join(' ')).toContain('指令预算');
});

it('ignores invalid overlay values and grades', () => {
  const host = createScriptHost([{ name: 'values.lua', source: `
    function on_load(state)
      pwp.line(0, { alpha = 2 })
      pwp.line(1, { alpha = 2, color = '#000000' })
      pwp.note('1:1', { tint = { 300, -5, 0 }, alpha = -1, width = 1000 })
      pwp.hud({})
      pwp.background('nope')
    end
    function on_judge(note, grade, state)
      return 'excellent'
    end
  ` }]);
  host.load(state());
  expect(host.overlay.lines.has(0)).toBe(false);
  expect(host.overlay.lines.get(1)).toEqual({ alpha: 1, color: [0, 0, 0] });
  expect(host.overlay.notes.get('1:1')).toEqual({ tint: [255, 0, 0], alpha: 0, width: 100 });
  expect(host.overlay.hud).toBeUndefined();
  expect(host.overlay.background).toBeUndefined();
  expect(host.judge(note, 'perfect', state())).toBe('perfect');
});
