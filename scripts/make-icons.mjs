#!/usr/bin/env node
/**
 * Rasterise the icon artwork (SVG) into the PNG sizes Chrome needs.
 *
 * Sources:  assets/icon/extension-icon.svg        (48 px and up)
 *           assets/icon/extension-icon-small.svg  (16 / 32 px: fewer details)
 * Output:   extension/icons/icon{16,32,48,128}.png  + dimmed "-off" variants
 *           assets/store/icon-512.png               (store listing)
 *
 * Rendering goes through headless Chrome over the DevTools protocol, so the
 * PNGs match exactly what Chrome itself draws (gradients, anti-aliasing).
 * The same Chrome for Testing binary the e2e test uses is picked up; pass
 * another binary as the first argument if needed.
 *
 *   node scripts/make-icons.mjs [chrome-binary]
 */
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const srcDir = join(root, 'assets', 'icon');
const outExt = join(root, 'extension', 'icons');
const outStore = join(root, 'assets', 'store');
mkdirSync(outExt, { recursive: true });
mkdirSync(outStore, { recursive: true });

/** size → { source svg, output files } */
const JOBS = [
  { size: 16, svg: 'extension-icon-small.svg', out: [join(outExt, 'icon16.png')], off: join(outExt, 'icon16-off.png') },
  { size: 32, svg: 'extension-icon-small.svg', out: [join(outExt, 'icon32.png')], off: join(outExt, 'icon32-off.png') },
  { size: 48, svg: 'extension-icon.svg', out: [join(outExt, 'icon48.png')], off: join(outExt, 'icon48-off.png') },
  // The store shows the 128 px icon on its own: keep the recommended transparent margin around it.
  { size: 128, pad: 0.09, svg: 'extension-icon.svg', out: [join(outExt, 'icon128.png')], off: join(outExt, 'icon128-off.png') },
  { size: 512, svg: 'extension-icon.svg', out: [join(outStore, 'icon-512.png')] }
];

function findChrome() {
  if (process.argv[2]) return process.argv[2];
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  try {
    const found = execSync(
      `find "${process.env.HOME}/Library/Caches/ms-playwright" -type f \\( -name Chromium -o -name 'Google Chrome for Testing' \\) -path '*MacOS*' 2>/dev/null | head -1`
    ).toString().trim();
    if (found) return found;
  } catch {}
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

const profile = mkdtempSync(join(tmpdir(), 'sd-icons-'));
const child = spawn(
  findChrome(),
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
   `--user-data-dir=${profile}`, '--remote-debugging-pipe', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
);

/* ---- minimal CDP-over-pipe client ---- */
const toChrome = child.stdio[3];
const fromChrome = child.stdio[4];
let buf = '';
let nextId = 0;
const pending = new Map();
fromChrome.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const raw = buf.slice(0, i);
    buf = buf.slice(i + 1);
    let msg;
    try { msg = JSON.parse(raw); } catch { continue; }
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    }
  }
});
function send(method, params = {}, sessionId) {
  return new Promise((res, rej) => {
    const id = ++nextId;
    pending.set(id, { res, rej });
    toChrome.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}

/** Wrap an SVG so it fills the viewport exactly; `dim` renders the switched-off look. */
function page(svg, dim, pad = 0) {
  const side = `${(100 * (1 - 2 * pad)).toFixed(3)}vw`;
  const css = `html,body{margin:0;background:transparent;overflow:hidden}` +
    `svg{display:block;width:${side};height:${side};margin:${(100 * pad).toFixed(3)}vw}` +
    (dim ? `svg{filter:grayscale(1) brightness(.85);opacity:.55}` : '');
  return `<!doctype html><meta charset="utf-8"><style>${css}</style>${svg}`;
}

let exitCode = 0;
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, sessionId);

  async function render(svg, size, dim, pad) {
    await send('Emulation.setDeviceMetricsOverride',
      { width: size, height: size, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Page.setDocumentContent', {
      frameId: (await send('Page.getFrameTree', {}, sessionId)).frameTree.frame.id,
      html: page(svg, dim, pad)
    }, sessionId);
    // Two frames so layout and compositing have settled.
    await send('Runtime.evaluate', {
      expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
      awaitPromise: true
    }, sessionId);
    const shot = await send('Page.captureScreenshot', {
      format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 }
    }, sessionId);
    return Buffer.from(shot.data, 'base64');
  }

  for (const job of JOBS) {
    const svg = readFileSync(join(srcDir, job.svg), 'utf8');
    const png = await render(svg, job.size, false, job.pad);
    for (const out of job.out) writeFileSync(out, png);
    if (job.off) writeFileSync(job.off, await render(svg, job.size, true, job.pad));
    console.log(`  ${String(job.size).padStart(3)} px  ←  ${job.svg}${job.off ? '  (+ off)' : ''}`);
  }
  console.log('✔ icons written to', outExt, 'and', outStore);
} catch (err) {
  console.error('✖', err.message);
  exitCode = 1;
} finally {
  child.kill();
  await new Promise((r) => child.once('exit', r));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(exitCode);
