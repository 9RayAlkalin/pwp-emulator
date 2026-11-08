import { defineConfig } from 'vite';
import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createReadStream } from 'node:fs';

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
  optimizeDeps: { entries: ['index.html'], include: ['@ffmpeg/ffmpeg'] },
  server: {
    allowedHosts: ['pwp.arkra.cc.cd'],
    watch: { ignored: ['**/verification-edge-profile/**'] },
  },
  plugins: [{
    name: 'simulator-resources',
    async buildStart() { await updateAvatarIndex(); },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split('?')[0];
        if (url === '/isolation-service-worker.js') {
          response.setHeader('Content-Type', 'text/javascript'); response.setHeader('Cache-Control', 'no-cache');
          createReadStream(resolve('src/core/export/isolation-service-worker.js')).pipe(response); return;
        }
        const match = url?.match(/^\/assets\/(ffmpeg(?:-mt)?)\/(ffmpeg-core\.(?:js|wasm|worker\.js))$/);
        if (!match) { next(); return; }
        const [, directory, name] = match;
        response.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        const stream = createReadStream(resolve(directory === 'ffmpeg-mt' ? 'node_modules/@ffmpeg/core-mt/dist/esm' : 'node_modules/@ffmpeg/core/dist/esm', name));
        stream.on('error', next); stream.pipe(response);
      });
      const refresh = (path: string) => {
        if (/[/\\]assets[/\\]avatars[/\\].+\.(png|jpe?g|webp)$/i.test(path)) void updateAvatarIndex();
      };
      server.watcher.on('add', refresh).on('unlink', refresh);
    },
    async closeBundle() {
      await cp(resolve('node_modules/@ffmpeg/core/dist/esm'), resolve('dist/assets/ffmpeg'), { recursive: true });
      await cp(resolve('node_modules/@ffmpeg/core-mt/dist/esm'), resolve('dist/assets/ffmpeg-mt'), { recursive: true });
      await cp(resolve('src/core/export/isolation-service-worker.js'), resolve('dist/isolation-service-worker.js'));
      await cp(resolve('third-party'), resolve('dist/third-party'), { recursive: true });
      await cp(resolve('assets'), resolve('dist', 'assets'), { recursive: true });
    },
  }],
});
