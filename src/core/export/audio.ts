import type { ExportTimeline } from '../export-timeline';

export async function renderAudio(music: AudioBuffer, result: AudioBuffer | undefined, plan: ExportTimeline, duration: number): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * 48000)), 48000);
  if (plan.start < music.duration) {
    const source = context.createBufferSource(); source.buffer = music;
    source.connect(context.destination);
    source.start(plan.musicStart, plan.start, Math.max(0, Math.min(plan.end, music.duration) - plan.start));
  }
  if (plan.resultSeconds && result) {
    const source = context.createBufferSource(); source.buffer = result; source.loop = true;
    source.connect(context.destination); source.start(plan.resultStart); source.stop(duration);
  }
  return context.startRendering();
}

// PCM16 WAV is accepted by both FFmpeg and ordinary media tools.
export function audioWav(audio: AudioBuffer): Uint8Array<ArrayBuffer> {
  const channels = audio.numberOfChannels, bytes = new Uint8Array(44 + audio.length * channels * 2);
  const view = new DataView(bytes.buffer), text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index);
  };
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes.length - 44, true);
  const planes = Array.from({ length: channels }, (_, channel) => audio.getChannelData(channel));
  for (let frame = 0; frame < audio.length; frame++) for (let channel = 0; channel < channels; channel++) {
    const value = Math.max(-1, Math.min(1, planes[channel][frame]));
    view.setInt16(44 + (frame * channels + channel) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
