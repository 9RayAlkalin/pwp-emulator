interface CanvasRenderingContext2D {
  drawLine(x0: number, y0: number, x1: number, y1: number, width: number, color: string): void;
  fillRectEx(x: number, y: number, width: number, height: number, color: string): void;
  drawCenterRotateImage(image: CanvasImageSource, x: number, y: number, width: number, height: number, degrees: number, skew?: number, flipY?: number): void;
}
