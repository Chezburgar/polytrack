// Drives the game in real Chrome via puppeteer-core for verification.
// Usage: node tools/browse.mjs <script.mjs> [--headful] [--url=/?dev | --url=https://...]
// The script default-exports async (page, h) => {...}; h.shot(name) saves
// .shots/<name>.png, h.eval(fn, ...args) runs in the page, h.sleep(ms).
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const scriptPath = args.find((a) => !a.startsWith('--'));
const headful = args.includes('--headful');
const urlArg = (args.find((a) => a.startsWith('--url=')) || '--url=/').slice(6);
const size = (args.find((a) => a.startsWith('--size=')) || '--size=1280x720').slice(7).split('x').map(Number);
const port = Number(process.env.PORT || 5180);
const chrome = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: headful ? false : true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', `--window-size=${size[0]},${size[1]}`,
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: size[0], height: size[1] },
});
const logs = [];
async function newPage() {
  const page = await browser.newPage();
  page.on('console', (m) => { const t = `[${m.type()}] ${m.text()}`; logs.push(t); if (m.type() === 'error' || m.type() === 'warn' || process.env.VERBOSE) console.log(t); });
  page.on('pageerror', (e) => { const t = `[pageerror] ${e.message}\n${e.stack || ''}`; logs.push(t); console.log(t); });
  return page;
}
const page = await newPage();
await mkdir(join(root, '.shots'), { recursive: true });
const h = {
  root,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  shot: async (name, p = page) => { const f = join(root, '.shots', name + '.png'); await p.screenshot({ path: f }); console.log('shot', f); return f; },
  eval: (fn, ...a) => page.evaluate(fn, ...a),
  newPage,
  browser,
  logs,
  // Git Bash rewrites a leading "/" into its install path; accept either form.
  url: (u = urlArg) => /^https?:/.test(u) ? u : `http://localhost:${port}/${u.replace(/^[A-Za-z]:\/.*?\/Git\//, '').replace(/^\//, '')}`,
  save: (name, text) => writeFile(join(root, '.shots', name), text),
};
try {
  await page.goto(h.url(), { waitUntil: 'load' });
  const mod = await import(pathToFileURL(resolve(scriptPath)).href);
  await mod.default(page, h);
} catch (e) {
  console.log('SCRIPT ERROR', e && e.stack || e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
