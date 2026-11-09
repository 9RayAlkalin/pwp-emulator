// Shared drawing helpers used by the preserved Canvas/WebGL effect pipeline.
declare global {
  interface CanvasRenderingContext2D {
    drawLine(x0: number, y0: number, x1: number, y1: number, width: number, color: string): void;
    fillRectEx(x: number, y: number, width: number, height: number, color: string): void;
    drawCenterRotateImage(image: CanvasImageSource, x: number, y: number, width: number, height: number, degrees: number, skew?: number, flipY?: number): void;
  }
}

CanvasRenderingContext2D.prototype.drawLine = function (x0, y0, x1, y1, width, color) {
  this.save(); this.beginPath(); this.moveTo(x0, y0); this.lineTo(x1, y1);
  this.lineWidth = width; this.strokeStyle = color; this.stroke(); this.restore();
};
CanvasRenderingContext2D.prototype.fillRectEx = function (x, y, width, height, color) {
  this.save(); this.fillStyle = color; this.fillRect(x, y, width, height); this.restore();
};
CanvasRenderingContext2D.prototype.drawCenterRotateImage = function (image, x, y, width, height, degrees, skew = 0, flipY = 1) {
  this.save(); this.translate(x, y); this.rotate(degrees * Math.PI / 180);
  if (flipY !== 1) this.scale(1, flipY);
  if (skew) this.transform(1, 0, Math.tan(skew * Math.PI / 180), 1, 0, 0);
  this.drawImage(image, -width / 2, -height / 2, width, height); this.restore();
};
export {};
