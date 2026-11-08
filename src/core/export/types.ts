export type ExportBackend = 'ffmpeg' | 'webcodecs';
import type { BrowserCodec, Container, EncodingOptions } from './options';

export interface EncoderConfig {
  width: number; height: number; fps: number; frames: number; bitrate: number;
  audio?: AudioBuffer;
  encoding?: Partial<EncodingOptions>;
  hardwareAcceleration?: HardwareAcceleration;
  browserCodec?: BrowserCodec;
  signal: AbortSignal;
  status(message: string): void;
}

export interface FrameEncoder {
  extension: Container;
  write(canvas: HTMLCanvasElement, index: number): Promise<void>;
  finish(): Promise<Blob>;
  close(): void;
}

export function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('已取消');
}

// MessageChannel also yields when a background tab throttles timers.
export const yieldFrame = () => new Promise<void>(resolve => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
  channel.port2.postMessage(0);
});
