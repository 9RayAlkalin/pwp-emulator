import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** ZIP-based chart extensions have no registered MIME type in Vite's static server. */
export function chartPacks(root: string, base = '/') {
  const assets = resolve(root, 'assets');
  return (request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void): void => {
    if (request.method !== 'GET' && request.method !== 'HEAD') { next(); return; }
    let pathname: string;
    try { pathname = decodeURIComponent((request.url ?? '').split('?')[0]); }
    catch { next(); return; }
    if (base.startsWith('/') && base !== '/' && pathname.startsWith(base)) pathname = '/' + pathname.slice(base.length);
    if (!/^\/assets\/.+\.(?:zepc|pez)$/i.test(pathname)) { next(); return; }
    const file = resolve(assets, pathname.slice('/assets/'.length));
    const path = relative(assets, file);
    if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) { next(); return; }
    void stat(file).then(info => {
      if (!info.isFile()) { next(); return; }
      response.setHeader('Content-Type', 'application/zip');
      response.setHeader('Content-Length', info.size);
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(file);
      response.on('close', () => stream.destroy());
      stream.on('error', error => { if (response.headersSent) response.destroy(error); else next(error); });
      stream.pipe(response);
    }).catch(error => {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') next();
      else next(error);
    });
  };
}
