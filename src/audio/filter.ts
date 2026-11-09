// Native LevelControl.Start / ProgressControl.LerpLowPassFilter: 1500Hz, 0.1s,
// release towards 22000Hz, then disable the music filter. Hit sounds stay dry.
export class MusicLowPass {
  readonly filter: BiquadFilterNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  private source?: MediaElementAudioSourceNode;
  private blocked = false;
  private start = 1500;
  private target = 1500;
  private since = 0;
  constructor(private readonly context: AudioContext) {
    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0;
    this.dry = context.createGain();
    this.wet = context.createGain();
    this.dry.connect(context.destination);
    this.filter.connect(this.wet).connect(context.destination);
    this.reset();
  }
  attach(element: HTMLMediaElement): void {
    let source = this.sources.get(element);
    if (!source) { source = this.context.createMediaElementSource(element); this.sources.set(element, source); }
    if (source === this.source) return;
    this.source?.disconnect();
    source.connect(this.dry);
    source.connect(this.filter);
    this.source = source;
    this.reset();
  }
  private frequencyAt(time: number): number {
    return this.start + (this.target - this.start) * Math.max(0, Math.min(1, (time - this.since) / 0.1));
  }
  setBlocked(blocked: boolean): void {
    if (blocked === this.blocked) return;
    const now = this.context.currentTime;
    this.start = this.frequencyAt(now);
    this.target = blocked ? 1500 : 22000;
    this.since = now;
    this.blocked = blocked;
    this.filter.frequency.cancelScheduledValues(now);
    this.filter.frequency.setValueAtTime(this.start, now);
    this.filter.frequency.linearRampToValueAtTime(this.target, now + 0.1);
    this.dry.gain.cancelScheduledValues(now);
    this.wet.gain.cancelScheduledValues(now);
    this.dry.gain.setValueAtTime(0, now);
    this.wet.gain.setValueAtTime(1, now);
    if (!blocked) {
      this.dry.gain.setValueAtTime(1, now + 0.1);
      this.wet.gain.setValueAtTime(0, now + 0.1);
    }
  }
  reset(): void {
    this.blocked = false;
    this.start = this.target = 1500;
    this.since = this.context.currentTime;
    for (const [parameter, value] of [[this.filter.frequency, 1500], [this.dry.gain, 1], [this.wet.gain, 0]] as const) {
      parameter.cancelScheduledValues(this.since);
      parameter.setValueAtTime(value, this.since);
    }
  }
}
