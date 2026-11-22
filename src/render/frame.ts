export interface FrameTargets {
  output: HTMLCanvasElement;
  foreground: HTMLCanvasElement;
  background: HTMLCanvasElement;
}
export interface FramePasses {
  drawScene(context: CanvasRenderingContext2D, time: number, layer?: 'bg' | 'fg'): void | Promise<void>;
  drawHud(context: CanvasRenderingContext2D, musicTime: number): void;
  beforeHud?(context: CanvasRenderingContext2D, chartTime: number): void;
  drawBlocks(context: CanvasRenderingContext2D, time: number): void;
  composite(scene: HTMLCanvasElement, output: HTMLCanvasElement, time: number, background: HTMLCanvasElement | null): void;
}

// Live playback and offline video output share this ordering. Time ownership,
// input and scoring stay in the player; codecs consume the resulting canvas.
export function renderGameplayFrame(targets: FrameTargets, chartTime: number, musicTime: number, split: boolean, passes: FramePasses): void | Promise<void> {
  const finish = () => {
    const foreground = targets.foreground.getContext('2d')!;
    passes.beforeHud?.(foreground, chartTime);
    passes.drawHud(foreground, musicTime);
    passes.drawBlocks(foreground, chartTime);
    if (targets.foreground !== targets.output) {
      passes.composite(targets.foreground, targets.output, chartTime, split ? targets.background : null);
    }
  };
  if (split) {
    const background = passes.drawScene(targets.background.getContext('2d')!, chartTime, 'bg');
    const foreground = () => {
      const result = passes.drawScene(targets.foreground.getContext('2d')!, chartTime, 'fg');
      return result instanceof Promise ? result.then(finish) : finish();
    };
    return background instanceof Promise ? background.then(foreground) : foreground();
  }
  const scene = passes.drawScene(targets.foreground.getContext('2d')!, chartTime);
  return scene instanceof Promise ? scene.then(finish) : finish();
}
