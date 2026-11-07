import { defineConfig } from 'vite';
import { cp } from 'node:fs/promises';
import { resolve } from 'node:path';

// Keep resource paths compatible with import_library.py and existing chart manifests.
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [{
    name: 'simulator-resources',
    async closeBundle() {
      for (const directory of ['res', 'shader']) {
        await cp(resolve(directory), resolve('dist', directory), { recursive: true });
      }
    },
  }],
});
