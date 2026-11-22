export function spectrumCadence(scripts: readonly { source: string }[]): number | undefined {
  for (const { source } of scripts) {
    const hz = Number(/^[\t ]*--[\t ]*pwp:spectrum-hz=(\d+)[\t ]*$/m.exec(source)?.[1]);
    if (hz >= 1 && hz <= 240) return hz;
  }
}

/** Phigros 2.5.1 Unity spectrum reduction, evaluated from channel zero.
 * libunity.so ARM64 RVA 0x9b026c, image base 0: input /N; output magnitudes
 * multiply by 2.5 and clamp per bin to 1. The last of 4096 output bins stays 0.
 * SHA256 288be853f8aab4e3e9fce8ab0a6e6f094dd16f3d7dd07b1fcbc72c7246d5fa44.
 * Full sample identity and native/reference evidence: april-fools-2.5.1.md. */
export class Spectrum {
  private readonly real = new Float64Array(8192);
  private readonly imaginary = new Float64Array(8192);
  private lastSample = -1;
  private lastValue = 0;
  constructor(private readonly audio: AudioBuffer, private readonly cadenceHz?: number) {}
  meanSquare(time: number): number {
    const t = Math.max(0, time);
    // Anchor to chart time, not the previous render, for deterministic seeks.
    // The tiny tolerance covers floating-point error on exact export ticks.
    const pos = this.cadenceHz === undefined ? t * this.audio.sampleRate
      : Math.floor(t * this.cadenceHz + 1e-9) * this.audio.sampleRate / this.cadenceHz;
    const end = Math.floor(pos);
    if (end === this.lastSample) return this.lastValue;
    this.lastSample = end;
    const samples = this.audio.getChannelData(0), n = this.real.length;
    for (let i = 0; i < n; i++) {
      let reverse = 0, value = i;
      for (let bit = 0; bit < 13; bit++) { reverse = (reverse << 1) | (value & 1); value >>>= 1; }
      this.real[reverse] = (samples[end - n + i] ?? 0) / n;
      this.imaginary[reverse] = Math.fround(1e-8);
    }
    for (let size = 2; size <= n; size *= 2) {
      const angle = -2 * Math.PI / size, cosine = Math.cos(angle), sine = Math.sin(angle);
      for (let base = 0; base < n; base += size) {
        let wr = 1, wi = 0;
        for (let offset = 0; offset < size / 2; offset++) {
          const a = base + offset, b = a + size / 2;
          const r = this.real[b] * wr - this.imaginary[b] * wi;
          const im = this.real[b] * wi + this.imaginary[b] * wr;
          this.real[b] = this.real[a] - r; this.imaginary[b] = this.imaginary[a] - im;
          this.real[a] += r; this.imaginary[a] += im;
          const next = wr * cosine - wi * sine;
          wi = wr * sine + wi * cosine; wr = next;
        }
      }
    }
    let sum = 0;
    for (let i = 0; i < n / 2 - 1; i++) {
      const magnitude = Math.min(1, Math.hypot(this.real[i], this.imaginary[i]) * 2.5);
      sum += magnitude * magnitude;
    }
    return this.lastValue = sum / (n / 2);
  }
}
