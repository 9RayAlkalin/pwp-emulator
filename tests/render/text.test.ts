import { expect, it, vi } from 'vitest';
import { LineTextLayout } from '../../src/render/text';

it('reuses multiline layout until text or font changes and releases chart-local entries', () => {
  const context = { font: '20px sans-serif', measureText: vi.fn((text: string) => ({ width: text.length * 10 })) };
  const cache = new LineTextLayout(), ctx = context as unknown as CanvasRenderingContext2D;
  expect(cache.get(ctx, 'ab\nc')).toEqual({ rows: ['ab', 'c'], width: 20 });
  cache.get(ctx, 'ab\nc'); expect(context.measureText).toHaveBeenCalledTimes(2);
  context.font = '30px sans-serif'; cache.get(ctx, 'ab\nc'); expect(context.measureText).toHaveBeenCalledTimes(4);
  cache.clear(); cache.get(ctx, 'ab\nc'); expect(context.measureText).toHaveBeenCalledTimes(6);
});
