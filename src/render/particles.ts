// Phigros 4.0.1.2 ARM64 libunity kernels. Address/provenance and limitations:
// See the workspace research/notes/original-particle-algorithm.md.
// The caller supplies the system seed; this module uses a canonical 60Hz
// schedule for repeatable seeking/export, not the native player's frame clock.
const f = Math.fround;
const randomScale = 1.1920930376163597e-7; // float bits 0x34000001
const randomFloat = (value: number) => f((value & 0x7fffff) * randomScale);
const shift = (x: number, w: number) => {
  const t = (x ^ x << 11) >>> 0;
  return (w ^ w >>> 19 ^ t ^ t >>> 8) >>> 0;
};

export function particleRandom4(seed: number): () => number[] {
  // 0x5b22e4; each lane has independent x/y/z/w state.
  const lanes = [0, 367, 734, 1101].map(offset => {
    const x = (seed + offset) >>> 0;
    const y = (Math.imul(1812433253, x) + 1) >>> 0;
    const z = (Math.imul(1812433253, y) + 1) >>> 0;
    return [x, y, z, (Math.imul(1812433253, z) + 1) >>> 0];
  });
  return () => lanes.map(lane => {
    const [x, y, z, w] = lane, n = shift(x, w);
    lane[0] = y; lane[1] = z; lane[2] = w; lane[3] = n;
    return n;
  });
}

function speedFromId(id: number): number {
  // 0xd1dcf8..0xd1dd44. Speed is derived from the particle's random ID.
  const x = (id + 0x96aa4de3) >>> 0;
  const w = (0x714acb3f + Math.imul(0x6ab51b9d, x)) >>> 0;
  return f(15 + f(20 * randomFloat(shift(x, w))));
}

function cosineTurns(turns: number): number {
  turns = f(turns);
  const magic = turns < 0 ? -8388608 : 8388608;
  const rounded = f(f(turns + magic) - magic);
  const z = f(0.25 - Math.abs(f(turns - rounded))), z2 = f(z * z), z4 = f(z2 * z2);
  const a = f(6.283185005187988 - f(z2 * 41.34165954589844));
  const b = f(z4 * f(81.60182189941406 - f(z2 * 76.56861877441406)));
  const c = f(f(z4 * z4) * 39.65703201293945);
  return f(z * f(c + f(a + b)));
}

function coefficients(start: number, end: number, outSlope: number, inSlope: number, scalar = 1): number[] {
  const p0 = f(start), delta = f(f(end) - p0), m0 = f(outSlope), m1 = f(inSlope);
  return [f(f(f(m0 + m1) - delta) - delta),
    f(f(f(f(delta + f(delta + delta)) - m0) - m0) - m1), m0, p0].map(c => f(c * scalar));
}
const drag = coefficients(0, 1, 2.1999998, 0, 5);
const size = coefficients(0.49884492, 0.6941143, 1.6398785, -1.0415096);
function curve(c: readonly number[], u: number): number {
  u = f(Math.max(0, u));
  return f(c[3] + f(u * f(c[2] + f(u * f(c[1] + f(u * c[0]))))));
}
export function particleDragStep(speed: number, age: number, dt: number): number {
  return Math.max(0, f(speed - f(f(dt) * f(curve(drag, f(age / 0.5)) * f(speed * speed)))));
}

export interface Particle {
  birth: number; firstFrame: number; seed: number; angle: number; radius: number;
  initialSpeed: number; originX: number; originY: number; dx: number; dy: number;
  ages: number[]; distance: number[];
}
interface RunningParticle { particle: Particle; age: number; speed: number; distance: number; }
const dt = f(1 / 60);
function advance(state: RunningParticle, delta: number): void {
  state.speed = particleDragStep(state.speed, state.age, delta);
  state.age = f(state.age + delta);
  state.distance = f(state.distance + f(state.speed * delta));
  state.particle.ages.push(state.age); state.particle.distance.push(state.distance);
}

export function createHitParticles(seed: number, grade: 'perfect' | 'good', scale = 1): Particle[] {
  const initial = particleRandom4(seed), shape = particleRandom4(seed);
  const states: RunningParticle[] = [], maximum = grade === 'perfect' ? 4 : 3;
  let remainder = 0;
  for (let frame = 1; frame <= 36; frame++) {
    const time = frame / 60;
    for (const state of states) if (state.age < 0.5) advance(state, dt);
    const emissionDt = f(Math.max(0, Math.min(time, 0.06) - Math.min((frame - 1) / 60, 0.06)));
    const amount = f(100 * emissionDt), total = f(remainder + amount);
    const requested = Math.trunc(total);
    remainder = f(total - requested);
    const count = Math.min(requested, maximum - states.length);
    if (count <= 0) continue;
    const ids = initial();
    // Constant properties still consume their four-wide RNG draw.
    for (let property = 0; property < 4; property++) initial();
    const angles = shape(), radii = shape();
    for (let lane = 0; lane < count; lane++) {
      const angle = f(f(f(360) * f(Math.PI / 180)) * randomFloat(angles[lane]));
      const turns = f(angle * 0.15915493667125702);
      const x = cosineTurns(turns), y = cosineTurns(f(turns - 0.25)), norm = Math.hypot(x, y);
      const inner = f(f(1 - f(0.2)) ** 2);
      const radius = f(f(0.2) * f(Math.sqrt(f(inner + f(f(1 - inner) * randomFloat(radii[lane]))))));
      // CC4E9C keeps the remainder AFTER truncation; D18574 emits youngest
      // first and D1C548 caps the count before initializing the SIMD batch.
      const fraction = Math.min(1, Math.max(f(1e-6), f(f(remainder + lane) / amount)));
      const partial = f(dt * fraction), speed = f(speedFromId(ids[lane]) * scale);
      const particle: Particle = { birth: time - partial, firstFrame: time, seed: ids[lane], angle,
        radius: f(radius * scale), initialSpeed: speed, originX: f(f(x * radius) * scale),
        originY: f(f(y * radius) * scale), dx: x / norm, dy: y / norm, ages: [0], distance: [0] };
      const state = { particle, age: 0, speed, distance: 0 };
      advance(state, partial); states.push(state);
    }
  }
  return states.map(state => state.particle);
}

export function sampleHitParticle(particle: Particle, elapsed: number) {
  const age = elapsed - particle.birth;
  if (age < 0 || age >= 0.5) return null;
  let low = 0, high = particle.ages.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (particle.ages[mid] <= age) low = mid; else high = mid;
  }
  const fraction = Math.max(0, Math.min(1, (age - particle.ages[low]) / (particle.ages[high] - particle.ages[low])));
  const distance = particle.distance[low] + (particle.distance[high] - particle.distance[low]) * fraction;
  return { x: particle.originX + particle.dx * distance, y: particle.originY + particle.dy * distance,
    size: f(0.3) * Math.max(0, curve(size, age / 0.5)), alpha: 1 - age / 0.5 };
}
