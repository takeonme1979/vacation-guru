#!/usr/bin/env node
/**
 * Zero-dependency static server.
 *
 * Browsers block ES modules and fetch() on file:// URLs, and service workers
 * need an http origin, so the app must be served rather than double-clicked.
 * This is the smallest thing that does that.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';

    // Contain everything under ROOT — no ../ escapes.
    const target = join(ROOT, normalize(path).replace(/^([/\\])+/, ''));
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(target).catch(() => null);
    if (!info || info.isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found: ' + path);
      return;
    }

    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'content-length': body.length
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end('Server error: ' + e.message);
  }
});

server.listen(PORT, () => {
  console.log(`\n  Vacation Guru running at  http://localhost:${PORT}\n`);
  console.log(`  serving ${ROOT}`);
  console.log('  press Ctrl+C to stop\n');
});
