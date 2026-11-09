import { describe, expect, it } from 'vitest';
import { createHitParticles, particleDragStep, particleRandom4 } from '../../src/render/particles';

// These values come from the separate stdlib scalar reference reconstructed
// from ARM64 instructions, not a capture of native gameplay frames.
describe('recovered particle kernels', () => {
  it('uses the native four lane seed offsets and logical right shifts', () => {
    expect(particleRandom4(42)()).toEqual([4076870683, 3970904528, 3864934564, 3754594572]);
    expect(particleRandom4(0xffffffff)()).toEqual([110471304, 3358637, 4190910660, 4083100060]);
  });
  it('evaluates drag at the old age, subtracts speed squared, and clamps at zero', () => {
    expect(particleDragStep(30, 0, 1 / 60)).toBe(30);
    expect(particleDragStep(30, 0.1, 1 / 60)).toBe(1.0800018310546875);
    expect(particleDragStep(30, 0.25, 0.2)).toBe(0);
  });
  it('matches the 60Hz reference batch order, speed hashing and trajectories', () => {
    const particles = createHitParticles(42, 'perfect');
    expect(particles.map(p => p.seed)).toEqual([4076870683, 1792162932, 3053434789, 2692197294]);
    expect(particles.map(p => p.initialSpeed)).toEqual([22.336997985839844, 17.320344924926758, 28.647315979003906, 22.14031982421875]);
    const births = [0.01, 0.03, 0.02, 0.05];
    const radii = [0.17780794203281403, 0.17808902263641357, 0.19814912974834442, 0.1866857409477234];
    const finalDistances = [1.9969847202301025, 1.7705318927764893, 2.2529149055480957, 2.0009875297546387];
    particles.forEach((p, i) => {
      expect(p.birth).toBeCloseTo(births[i], 6);
      expect(p.radius).toBe(radii[i]);
      expect(p.distance.at(-1)).toBe(finalDistances[i]);
    });
    expect(particles[0].distance.slice(0, 4)).toEqual([0, 0.14891333878040314, 0.5010415315628052, 0.791396975517273]);
    expect(particles[1].angle).toBe(4.249590873718262);
    expect(createHitParticles(42, 'good')).toEqual(particles.slice(0, 3));
  });
  it('applies emitter scale before drag, so larger bursts are not just longer trajectories', () => {
    const normal = createHitParticles(42, 'perfect')[0], scaled = createHitParticles(42, 'perfect', 1.35)[0];
    expect(scaled.initialSpeed).toBe(Math.fround(normal.initialSpeed * 1.35));
    expect(scaled.radius).toBe(Math.fround(normal.radius * 1.35));
    expect(scaled.distance.at(-1)).toBeLessThan(normal.distance.at(-1)! * 1.35);
  });
});
