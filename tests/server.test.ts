import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { expect, test } from 'vitest';
import { chartPacks } from '../server/packs';

test('serves complete binary chart packs with a ZIP content type for GET and HEAD', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pwp-packs-'));
  let server: ViteDevServer | undefined;
  try {
    const directory = join(root, 'assets', 'nested'); await mkdir(directory, { recursive: true });
    const bytes = Buffer.alloc(1024 * 1024 + 17, 0xc3); bytes.set([80, 75, 3, 4]);
    await writeFile(join(directory, '雪降.zepc'), bytes);
    await writeFile(join(directory, 'chart.pez'), bytes);
    await writeFile(join(root, 'private.zepc'), bytes);
    server = await createServer({ configFile: false, root, logLevel: 'silent', server: { host: '127.0.0.1', port: 0 },
      plugins: [{ name: 'chart-packs', configureServer: server => { server.middlewares.use(chartPacks(root, '/pwp/')); } }] });
    await server.listen();
    const { port } = server.httpServer!.address() as { port: number };
    for (const [prefix, filename] of [['', '雪降.zepc'], ['', 'chart.pez'], ['/pwp', '雪降.zepc']]) {
      const url = `http://127.0.0.1:${port}${prefix}/assets/nested/${encodeURIComponent(filename)}?v=1`;
      const response = await fetch(url, { headers: { Connection: 'close' } });
      expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('application/zip');
      expect(response.headers.get('content-length')).toBe(String(bytes.length));
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
      const head = await fetch(url, { method: 'HEAD', headers: { Connection: 'close' } });
      expect(head.status).toBe(200); expect(head.headers.get('content-type')).toBe('application/zip');
      expect((await head.arrayBuffer()).byteLength).toBe(0);
    }
    const outside = await fetch(`http://127.0.0.1:${port}/assets/%2e%2e%2fprivate.zepc`, { headers: { Connection: 'close' } });
    expect(outside.headers.get('content-type')).not.toBe('application/zip');
  } finally { await server?.close(); await rm(root, { recursive: true, force: true }); }
}, 20_000);

test('Vite keeps concurrent restarts locked until the replacement server is listening', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pwp-vite-restart-'));
  let server: ViteDevServer | undefined;
  let starts = 0;
  let instances = 0;
  const locks: unknown[] = [];
  const creationLocks: unknown[] = [];
  const overlappingRestarts: Promise<void>[] = [];
  try {
    server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 },
      plugins: [{
        name: 'restart-during-startup',
        configureServer(replacement) {
          instances++;
          if (instances === 1) return;
          // The new watcher is already active before _createServer returns.
          const lock = (replacement as ViteDevServer & { _restartPromise: Promise<void> | null })._restartPromise;
          creationLocks.push(lock);
          if (lock) overlappingRestarts.push(replacement.restart());
        },
        buildStart() {
          starts++;
          if (starts === 1) return;
          // Reproduce a config change after Object.assign swaps the server,
          // but before the replacement HTTP server starts listening.
          const lock = (server as ViteDevServer & { _restartPromise: Promise<void> | null })._restartPromise;
          locks.push(lock);
          if (lock) overlappingRestarts.push(server!.restart());
        },
      }],
    });
    await server.listen();
    for (let cycle = 0; cycle < 3; cycle++) {
      await server.restart();
      await Promise.all(overlappingRestarts);
      expect(server.httpServer?.listening).toBe(true);
    }
    expect(starts).toBe(4);
    expect(locks).toHaveLength(3);
    expect(locks.every(lock => lock instanceof Promise)).toBe(true);
    expect(creationLocks).toHaveLength(3);
    expect(creationLocks.every(lock => lock instanceof Promise)).toBe(true);
    expect(overlappingRestarts).toHaveLength(6);
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
