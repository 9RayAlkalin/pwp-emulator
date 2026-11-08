import { defineConfig } from 'vite';
import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function updateAvatarIndex() {
  const directory = resolve('assets/avatars');
  const files = (await readdir(directory)).filter(file => /\.(png|jpe?g|webp)$/i.test(file)).sort();
  const data = JSON.stringify(files.map(file => ({ id: file.replace(/\.[^.]+$/, ''), name: file.replace(/\.[^.]+$/, ''), file })), null, 2) + '\n';
  const output = resolve(directory, 'index.json');
  if (await readFile(output, 'utf8').catch(() => '') !== data) await writeFile(output, data);
}

export default defineConfig({
  base: './',
  publicDir: false,
  server: {
    allowedHosts: ['pwp.arkra.cc.cd'],
    watch: { ignored: ['**/verification-edge-profile/**'] },
  },
  plugins: [{
    name: 'simulator-resources',
    async buildStart() { await updateAvatarIndex(); },
    configureServer(server) {
      const refresh = (path: string) => {
        if (/[/\\]assets[/\\]avatars[/\\].+\.(png|jpe?g|webp)$/i.test(path)) void updateAvatarIndex();
      };
      server.watcher.on('add', refresh).on('unlink', refresh);
    },
    async closeBundle() {
      await cp(resolve('assets'), resolve('dist', 'assets'), { recursive: true });
    },
  }],
});
