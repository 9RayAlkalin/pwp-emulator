import type { ScriptOverlay } from '../chart/script/lua';
import type { ChartTextures } from './textures';

/** Script coordinates share the canvas with input and offline frame rendering. */
export function drawScriptOverlay(ctx: CanvasRenderingContext2D, overlay: ScriptOverlay | undefined,
                                  textures: ChartTextures | undefined, time: number): void {
  if (!overlay) return;
  const { width, height } = ctx.canvas;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (overlay.screen) {
    ctx.fillStyle = `rgb(${overlay.screen.color.join(',')})`;
    ctx.globalAlpha = overlay.screen.alpha;
    ctx.fillRect(0, 0, width, height);
  }
  for (const element of overlay.elements.values()) {
    if (element.alpha <= 0) continue;
    ctx.save(); ctx.globalAlpha = element.alpha;
    ctx.translate(element.x * width, element.y * height);
    ctx.rotate(element.rotation * Math.PI / 180);
    const w = element.width * width, h = element.height * height;
    const texture = element.texture && textures?.get(element.texture, time);
    if (texture) ctx.drawImage(texture.image, -w / 2, -h / 2, w, h);
    else if (element.color) {
      ctx.fillStyle = `rgb(${element.color.join(',')})`;
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    if (element.text) {
      ctx.font = `${Math.max(6, element.size * height)}px PhiHUD, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      ctx.fillText(element.text, 0, 0, w || width);
    }
    ctx.restore();
  }
  ctx.restore();
}
