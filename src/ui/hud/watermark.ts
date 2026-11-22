import { name, version } from '../../../package.json';

const labels = {
  auto: name + ' v' + version + ' · AUTO',
  manual: name + ' v' + version + ' · MANUAL',
};

export function drawGameplayWatermark(ctx: CanvasRenderingContext2D, autoplay: boolean, scaleY = 1): void {
  const { width, height } = ctx.canvas;
  if (scaleY <= 0 || !width || !height) return;

  // Match the HUD transition around the canvas centre, on the final output.
  ctx.save();
  ctx.setTransform(1, 0, 0, scaleY, 0, height * (1 - scaleY) / 2);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = .55;
  ctx.filter = 'none';
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#fff';
  ctx.font = '400 ' + Math.max(8, height * .013) + 'px PhiHUD, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(autoplay ? labels.auto : labels.manual, width / 2, height * .99, width * .8);
  ctx.restore();
}
