import type { BrowserCodec, Container, EncodingOptions } from './options';

export type ExportBackend = 'ffmpeg' | 'webcodecs';

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
