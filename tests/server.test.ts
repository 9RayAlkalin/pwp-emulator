import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { expect, test } from 'vitest';

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
