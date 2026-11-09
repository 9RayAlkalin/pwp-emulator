import { afterEach, expect, it, vi } from 'vitest';
import { ChartFonts } from '../../src/core/chart-fonts';
afterEach(() => vi.unstubAllGlobals());

it('uses PhiHUD by default, loads chart fonts under isolated families and releases them', async () => {
  const add = vi.fn(), remove = vi.fn();
  vi.stubGlobal('document', { fonts: { add, delete: remove } });
  vi.stubGlobal('FontFace', class { constructor(public family: string) {} async load() { return this; } });
  const a = await ChartFonts.load({ 'MiSans.ttf': new Blob(['font']) }), b = await ChartFonts.load({ 'MiSans.ttf': new Blob(['font']) });
  expect(a.family()).toBe('PhiHUD, sans-serif'); expect(a.family('missing.ttf')).toBe('PhiHUD, sans-serif');
  expect(a.family('MiSans.ttf')).not.toBe(b.family('MiSans.ttf')); expect(add).toHaveBeenCalledTimes(2);
  a.dispose(); b.dispose(); expect(remove).toHaveBeenCalledTimes(2);
});

it('removes already registered faces when loading a later font fails', async () => {
  const remove = vi.fn();
  vi.stubGlobal('document', { fonts: { add: vi.fn(), delete: remove } });
  let count = 0;
  vi.stubGlobal('FontFace', class { constructor(public family: string) {} async load() { if (count++) throw new Error('broken font'); return this; } });
  await expect(ChartFonts.load({ 'one.ttf': new Blob(['1']), 'two.ttf': new Blob(['2']) })).rejects.toThrow('broken font');
  expect(remove).toHaveBeenCalledTimes(2);
});
