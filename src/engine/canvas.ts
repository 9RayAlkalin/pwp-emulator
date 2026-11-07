// Shared drawing helpers used by the preserved Canvas/WebGL effect pipeline.
CanvasRenderingContext2D.prototype.drawLine = function (x0, y0, x1, y1, width, color) {
  this.save(); this.beginPath(); this.moveTo(x0, y0); this.lineTo(x1, y1);
  this.lineWidth = width; this.strokeStyle = color; this.stroke(); this.restore();
};
CanvasRenderingContext2D.prototype.fillRectEx = function (x, y, width, height, color) {
  this.save(); this.fillStyle = color; this.fillRect(x, y, width, height); this.restore();
};
CanvasRenderingContext2D.prototype.drawCenterRotateImage = function (image, x, y, width, height, degrees) {
  this.save(); this.translate(x, y); this.rotate(degrees * Math.PI / 180);
  this.drawImage(image, -width / 2, -height / 2, width, height); this.restore();
};
export {};
