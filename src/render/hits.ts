import { hitEffectDuration, hitEffectPosition, type HitEffect, type HitGrade } from '../gameplay/hits';
import { noteViewportScale } from '../gameplay/visuals';
import { SpriteTints } from './tints';
import { createHitParticles, sampleHitParticle, type Particle } from './particles';

const colors = { perfect: '#ffeca0', good: '#b4e1ff' };

export class HitEffectRenderer {
  private readonly tints = new SpriteTints();
  private readonly cache = new Map<string, Particle[]>();
  private frames: Record<HitGrade, CanvasImageSource[]> = { perfect: [], good: [] };
  private originalFrames: CanvasImageSource[] = [];
  setFrames(frames: Record<HitGrade, CanvasImageSource[]>): void { this.frames = frames; }
  setOriginalFrames(frames: CanvasImageSource[]): void { this.originalFrames = frames; }
  clear(): void { this.tints.clear(); this.cache.clear(); }
  draw(ctx: CanvasRenderingContext2D, effects: readonly HitEffect[], time: number,
       width: number, height: number, noteScale = 1, speed = 1): void {
    for (const effect of effects) {
      const elapsed = effect.elapsed ?? (time - effect.time) / speed;
      if (elapsed < 0 || elapsed >= hitEffectDuration) continue;
      const [x, y] = hitEffectPosition(effect, width, height);
      const frames = effect.note.tintHitEffects && this.originalFrames.length ? this.originalFrames : this.frames[effect.grade];
      const frame = frames[Math.min(frames.length - 1, Math.floor(elapsed / 0.5 * frames.length))];
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      // The shared sequence is the same in manual, autoplay and offline export.
      if (elapsed < 0.5 && frame) {
        const size = height * (2.56 * 1.35 / 10) * noteScale * (effect.note.master.get_viewport?.().gameplayScale ?? noteViewportScale(width, height));
        ctx.globalAlpha = effect.grade === 'perfect' ? 225 / 255 : 235 / 255;
        ctx.drawImage(this.tints.get(frame, effect.note.tintHitEffects), x - size / 2, y - size / 2, size, size);
      }
      const emitterScale = 1.35 * noteScale * (effect.note.master.get_viewport?.().gameplayScale ?? noteViewportScale(width, height));
      const key = `${effect.seed}:${effect.grade}:${emitterScale}`;
      let particles = this.cache.get(key);
      if (!particles) {
        particles = createHitParticles(effect.seed, effect.grade, emitterScale);
        if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, particles);
      }
      // ScoreControl/HoldControl overwrite prefab scale with 1.35 * note scale.
      // Velocity is scaled before world-space quadratic drag is evaluated.
      const scale = height / 10;
      ctx.fillStyle = effect.note.tintHitEffects ? `rgb(${effect.note.tintHitEffects.join(',')})` : colors[effect.grade];
      for (const particle of particles) {
        const state = sampleHitParticle(particle, elapsed);
        if (!state) continue;
        const size = state.size * scale * emitterScale;
        ctx.globalAlpha = state.alpha;
        ctx.fillRect(x + state.x * scale - size / 2, y - state.y * scale - size / 2, size, size);
      }
      ctx.restore();
    }
  }
}
