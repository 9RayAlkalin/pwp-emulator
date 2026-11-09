export interface FrameTargets {
  output: HTMLCanvasElement;
  foreground: HTMLCanvasElement;
  background: HTMLCanvasElement;
}
export interface FramePasses {
  drawScene(context: CanvasRenderingContext2D, time: number, layer?: 'bg' | 'fg'): void;
  drawHud(context: CanvasRenderingContext2D, musicTime: number): void;
  drawBlocks(context: CanvasRenderingContext2D, time: number): void;
  composite(scene: HTMLCanvasElement, output: HTMLCanvasElement, time: number, background: HTMLCanvasElement | null): void;
}

// Live playback and offline video output share this ordering. Time ownership,
// input and scoring stay in the player; codecs consume the resulting canvas.
export function renderGameplayFrame(targets: FrameTargets, chartTime: number, musicTime: number, split: boolean, passes: FramePasses): void {
  if (split) {
    passes.drawScene(targets.background.getContext('2d')!, chartTime, 'bg');
    passes.drawScene(targets.foreground.getContext('2d')!, chartTime, 'fg');
  } else passes.drawScene(targets.foreground.getContext('2d')!, chartTime);
  const foreground = targets.foreground.getContext('2d')!;
  passes.drawHud(foreground, musicTime);
  passes.drawBlocks(foreground, chartTime);
  passes.composite(targets.foreground, targets.output, chartTime, split ? targets.background : null);
}
