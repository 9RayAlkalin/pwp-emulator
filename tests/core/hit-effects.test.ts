import { describe, expect, it } from 'vitest';
import { activeHitEffects, createHitEffect, createHitParticles, hitEffectPosition, HitEffectRenderer, sampleHitParticle } from '../../src/core/hit-effects';
import { Judge } from '../../src/core/judge';
import type { RuntimeNote } from '../../src/types';

const note = (type: 1 | 3 = 1): RuntimeNote => ({
  type, effectId: 17, time: 1, holdTime: type === 3 ? 1 : 0, positionX: 1, speed: 1,
  sect: 1, secht: type === 3 ? 1 : 0, hold_end_time: type === 3 ? 2 : 1,
  is_hold: type === 3, is_above: true, clicked: false,
  master: { bpm: 120, get_state: time => [time * 20, time * 0.1, 0.5, 1] },
});
const tap = (judge: Judge, time = 1) => judge.input('finger', 500, 250, 'tap', time, 1000, 500, true);

describe('shared hit effects', () => {
  it('uses an explicit hit-effect colour for both Perfect and Good particles', () => {
    for (const grade of ['perfect', 'good'] as const) {
      const n = note(); n.tintHitEffects = [106, 90, 205];
      const colors: string[] = [];
      const ctx = { fillStyle: '', globalAlpha: 1, save() {}, restore() {}, fillRect() { colors.push(this.fillStyle); } };
      new HitEffectRenderer().draw(ctx as unknown as CanvasRenderingContext2D, [createHitEffect(n, 1, grade)], 1.1, 1000, 500);
      expect(colors.length).toBeGreaterThan(0); expect(colors.every(c => c === 'rgb(106,90,205)')).toBe(true);
    }
  });
  it('only returns live bursts when seeking forwards, backwards and to effect boundaries', () => {
    const n = note();
    const events = [0, 1, 2].map(time => createHitEffect(n, time, 'perfect'));
    expect(activeHitEffects(events, -1)).toEqual([]);
    expect(activeHitEffects(events, 1)).toEqual([events[1]]);
    expect(activeHitEffects(events, 1.6)).toEqual([]);
    expect(activeHitEffects(events, 0.1)).toEqual([events[0]]);
    expect(activeHitEffects(events, 3)).toEqual([]);
  });
  it('uses identical effect data for an on-time manual Perfect and autoplay', () => {
    const n = note(), judge = new Judge(); judge.reset([n]); tap(judge);
    expect(judge.hitEffects).toMatchObject([createHitEffect(n, 1, 'perfect')]);
    expect(createHitParticles(judge.hitEffects[0].seed, 'perfect')).toEqual(createHitParticles(createHitEffect(n, 1, 'perfect').seed, 'perfect'));
  });
  it('only successful judgements emit effects, preserving Good colour and timing', () => {
    const judge = new Judge(); judge.reset([note()]); tap(judge, 1.1);
    expect(judge.hitEffects[0]).toMatchObject({ time: 1.1, grade: 'good' });
    judge.reset([note()]); tap(judge, 1.18); expect(judge.hitEffects).toHaveLength(0);
    judge.reset([note()]); judge.update(1.3); expect(judge.hitEffects).toHaveLength(0);
  });
  it('emits Hold feedback once per actual frame and drops excess elapsed time', () => {
    const n = note(3), dense = new Judge(), sparse = new Judge();
    dense.reset([n]); sparse.reset([n]); tap(dense); tap(sparse);
    for (let frame = 1; frame <= 79; frame++) dense.update(1 + frame / 100, 1000, 500, 0.01);
    dense.update(1.8); sparse.update(1.8);
    expect(sparse.hitEffects.map(effect => effect.time)).toEqual([1.8]);
    expect(dense.hitEffects.map(effect => effect.time)).toEqual([1.25, 1.5, 1.75]);
    sparse.input('finger', 0, 0, 'release', 1.8, 1000, 500, true); sparse.update(1.81);
    sparse.update(2.41); expect(sparse.hitEffects).toHaveLength(0);
  });
  it('gives consecutive Hold pulses fresh directions and offsets while keeping each pulse stable', () => {
    const n = note(3), judge = new Judge();
    judge.reset([n]); tap(judge); judge.update(1.25); judge.update(1.5);
    const pulses = judge.hitEffects;
    expect(pulses.map(effect => effect.time)).toEqual([1, 1.25, 1.5]);
    expect(new Set(pulses.map(effect => effect.seed)).size).toBe(3);
    const particles = pulses.map(effect => createHitParticles(effect.seed, effect.grade));
    const directions = particles.map(burst => burst.map(particle => particle.angle));
    expect(directions[1]).not.toEqual(directions[0]);
    expect(directions[2]).not.toEqual(directions[1]);
    const offsets = particles.map(burst => burst.map(particle => sampleHitParticle(particle, 0.12)));
    expect(offsets[1]).not.toEqual(offsets[0]);
    expect(offsets[2]).not.toEqual(offsets[1]);
    expect(createHitParticles(pulses[1].seed, pulses[1].grade)).toEqual(particles[1]);
    // A new pulse samples the moving line at its own time; older bursts keep their origin.
    expect(hitEffectPosition(pulses[1], 1000, 500)).not.toEqual(hitEffectPosition(pulses[0], 1000, 500));
    const origin = hitEffectPosition(pulses[0], 1000, 500);
    judge.update(1.6);
    expect(hitEffectPosition(pulses[0], 1000, 500)).toEqual(origin);
  });
  it('clears all transient effects when seeking/resetting and never replays missed notes', () => {
    const judge = new Judge(); const n = note(); judge.reset([n]); tap(judge);
    expect(judge.hitEffects).toHaveLength(1);
    judge.reset([n], 1.2); judge.update(1.3);
    expect(judge.hitEffects).toHaveLength(0);
  });
  it('freezes burst origins at judgement time and rescales them with the viewport', () => {
    const n = note(), effect = createHitEffect(n, 1.1, 'perfect');
    const a = hitEffectPosition(effect, 1000, 500), b = hitEffectPosition(effect, 2000, 1000);
    expect(b[0]).toBeCloseTo(a[0] * 2); expect(b[1]).toBeCloseTo(a[1] * 2);
    expect(hitEffectPosition(effect, 1000, 500)).toEqual(a);
  });
});

describe('particle lifecycle', () => {
  it('uses the prefab counts, delayed emission and independent half-second lifetimes', () => {
    const particles = createHitParticles(42, 'perfect');
    expect(particles).toHaveLength(4); expect(createHitParticles(42, 'good')).toHaveLength(3);
    expect(sampleHitParticle(particles[0], 0)).toBeNull();
    expect(sampleHitParticle(particles[0], particles[0].birth)?.alpha).toBe(1);
    expect(sampleHitParticle(particles[3], 0.03)).toBeNull();
    expect(sampleHitParticle(particles[0], particles[0].birth + 0.5)).toBeNull();
    expect(sampleHitParticle(particles[3], 0.53)).not.toBeNull();
    expect(sampleHitParticle(particles[3], 0.56)).toBeNull();
  });
  it('spreads outward with drag, follows the size curve, and fades without random frame jitter', () => {
    const p = createHitParticles(123, 'perfect')[0];
    const first = sampleHitParticle(p, p.birth)!, early = sampleHitParticle(p, p.birth + 0.1)!, later = sampleHitParticle(p, p.birth + 0.2)!;
    const radius = (value: { x: number; y: number }) => Math.hypot(value.x, value.y);
    expect(radius(early)).toBeGreaterThan(radius(first));
    expect(radius(later) - radius(early)).toBeLessThan(radius(early) - radius(first));
    expect(early.size).toBeGreaterThan(first.size); expect(later.alpha).toBeLessThan(early.alpha);
    expect(sampleHitParticle(p, p.birth + 0.2)).toEqual(later);
    expect(createHitParticles(123, 'perfect')).toEqual(createHitParticles(123, 'perfect'));
    expect(createHitParticles(124, 'perfect')).not.toEqual(createHitParticles(123, 'perfect'));
  });
});
