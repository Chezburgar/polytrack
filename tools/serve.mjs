// Local dev server for PolyTrack. Serves the repo root with no caching.
// Dev-only extras: POST /__shot?name=x saves a canvas data URL to .shots/x.png,
// POST /__log appends a line to .shots/page.log. The public build is plain static
// files and needs neither.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, appendFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 5180);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
  '.woff2': 'font/woff2', '.map': 'application/json', '.mp3': 'audio/mpeg',
};

function body(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rej);
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && url.pathname === '/__shot') {
      const data = await body(req);
      const name = (url.searchParams.get('name') || 'shot').replace(/[^\w.-]/g, '_');
      const b64 = data.slice(data.indexOf(',') + 1);
      await mkdir(join(root, '.shots'), { recursive: true });
      await writeFile(join(root, '.shots', name + '.png'), Buffer.from(b64, 'base64'));
      res.writeHead(200).end('ok');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/__log') {
      const data = await body(req);
      await mkdir(join(root, '.shots'), { recursive: true });
      await appendFile(join(root, '.shots', 'page.log'), data + '\n');
      res.writeHead(200).end('ok');
      return;
    }
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    const st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    const type = types[extname(file).toLowerCase()] || 'application/octet-stream';
    // byte ranges, so the music can start part way in (GitHub Pages serves them too)
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      const a = range[1] ? +range[1] : Math.max(0, st.size - +range[2]);
      const b = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
      if (a > b) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
      const data = (await readFile(file)).subarray(a, b + 1);
      res.writeHead(206, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': data.length });
      res.end(data);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(port, () => console.log(`PolyTrack dev server: http://localhost:${port}/`));
