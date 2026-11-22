import { afterEach, expect, it, vi } from 'vitest';
import { downloadPack } from '../../src/app/download';

afterEach(() => vi.unstubAllGlobals());
const payload = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4]);
const complete = () => new Response(payload, { headers: { 'content-length': String(payload.length) } });

it('preserves pack bytes and labels the downloaded File as ZIP', async () => {
  const fetch = vi.fn().mockResolvedValue(complete()); vi.stubGlobal('fetch', fetch);
  const file = await downloadPack('/assets/雪降.zepc', '雪降.zepc', () => {});
  expect(file.name).toBe('雪降.zepc'); expect(file.type).toBe('application/zip');
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(payload); expect(fetch).toHaveBeenCalledTimes(1);
});

it('retries an ERR_FAILED once with a cache reload', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(complete());
  vi.stubGlobal('fetch', fetch); const progress = vi.fn();
  expect((await downloadPack('/pack.zepc', 'pack.zepc', progress)).size).toBe(payload.length);
  expect(fetch).toHaveBeenNthCalledWith(2, '/pack.zepc', { cache: 'reload' });
  expect(progress).toHaveBeenLastCalledWith('重新读取曲包 pack.zepc');
});

it('retries an incomplete body instead of handing a partial archive to the importer', async () => {
  const partial = new Response(payload.slice(0, 4), { headers: { 'content-length': String(payload.length) } });
  const fetch = vi.fn().mockResolvedValueOnce(partial).mockResolvedValueOnce(complete()); vi.stubGlobal('fetch', fetch);
  expect((await downloadPack('/pack.zepc', 'pack.zepc', () => {})).size).toBe(payload.length);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('reports a missing pack without retrying an HTTP error', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 })); vi.stubGlobal('fetch', fetch);
  await expect(downloadPack('/missing.zepc', 'missing.zepc', () => {})).rejects.toThrow('HTTP 404');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('stops after two network failures and names the failing pack', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')); vi.stubGlobal('fetch', fetch);
  await expect(downloadPack('/pack.zepc', 'pack.zepc', () => {})).rejects.toThrow('曲包下载中断：pack.zepc');
  expect(fetch).toHaveBeenCalledTimes(2);
});
