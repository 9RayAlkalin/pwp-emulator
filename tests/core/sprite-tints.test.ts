import { afterEach, expect, it, vi } from 'vitest';
import { SpriteTints } from '../../src/core/sprite-tints';
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const contexts: any[] = [], canvases: any[] = [];
  vi.stubGlobal('document', { createElement: () => {
    const context = { drawImage: vi.fn(), fillRect: vi.fn(), globalCompositeOperation: '', fillStyle: '' };
    const canvas = { width: 0, height: 0, getContext: () => context };contexts.push(context);canvases.push(canvas);return canvas;
  } });
  return { contexts, canvases };
}
it('leaves original white sprites unchanged and caches multiplied RGB with its alpha mask', () => {
  const { contexts, canvases } = setup(), tints = new SpriteTints(), source = { width: 50, height: 20 } as HTMLCanvasElement;
  expect(tints.get(source)).toBe(source);expect(tints.get(source, [255,255,255])).toBe(source);expect(canvases).toHaveLength(0);
  const tinted = tints.get(source, [106,90,205]);
  expect(tints.get(source, 'rgb(106,90,205)')).toBe(tinted);expect(contexts[0].drawImage).toHaveBeenCalledTimes(2);
  expect(contexts[0].fillStyle).toBe('rgb(106,90,205)');expect(contexts[0].globalCompositeOperation).toBe('destination-in');
  expect(tints.get(source, [0,255,0])).not.toBe(tinted);tints.clear();expect(canvases.every(c=>c.width===0&&c.height===0)).toBe(true);
});
it('evicts old colour variants within its entry limit without modifying source sprites', () => {
  const { canvases } = setup(), tints = new SpriteTints(), source = { width: 10, height: 10 } as HTMLCanvasElement;
  for(let c=0;c<130;c++)tints.get(source,[c,0,0]);
  expect(canvases[0].width).toBe(0);expect(canvases.filter(c=>c.width>0)).toHaveLength(128);expect(source.width).toBe(10);
});
