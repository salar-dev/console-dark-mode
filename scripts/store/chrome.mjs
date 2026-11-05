#!/usr/bin/env node
/**
 * Start / stop a visible Chrome for Testing with the unpacked extension loaded
 * and a DevTools port open, so store screenshots can be taken from the real
 * consoles after the user signs in (the profile is throw-away; see STORE_PROFILE).
 *
 *   node scripts/store/chrome.mjs start [url]     opens the browser (default: Play Console)
 *   node scripts/store/chrome.mjs start --headless  same, without a window (for rendering local pages)
 *   node scripts/store/chrome.mjs status          lists open tabs
 *   node scripts/store/chrome.mjs stop            quits it
 *
 * Env: CHROME_BIN (binary), STORE_PROFILE (user-data-dir), STORE_CDP_PORT (default 9333).
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTargets, PORT, sleep } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const extDir = join(root, 'extension');
const profile = process.env.STORE_PROFILE || join(tmpdir(), 'console-dark-mode-store-profile');
const pidFile = join(profile, 'chrome.pid');

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  try {
    const found = execSync(
      `find "${process.env.HOME}/Library/Caches/ms-playwright" -type f -name 'Google Chrome for Testing' -path '*MacOS*' 2>/dev/null | head -1`
    ).toString().trim();
    if (found) return found;
  } catch {}
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

async function alive() {
  try { await listTargets(); return true; } catch { return false; }
}

const cmd = process.argv[2] || 'status';
if (cmd === 'start') {
  if (await alive()) { console.log('already running on port', PORT); process.exit(0); }
  mkdirSync(profile, { recursive: true });
  const headless = process.argv.includes('--headless');
  const url = process.argv.slice(3).find((a) => !a.startsWith('--')) || (headless ? 'about:blank' : 'https://play.google.com/console/');
  const child = spawn(
    findChrome(),
    [
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--load-extension=${extDir}`,
      '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled',
      '--disable-features=Translate', '--window-size=1360,940', '--window-position=60,60',
      ...(headless ? ['--headless=new', '--disable-gpu', '--hide-scrollbars'] : []), url
    ],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  for (let i = 0; i < 40 && !(await alive()); i++) await sleep(250);
  if (!(await alive())) { console.error('✖ Chrome did not open the DevTools port'); process.exit(1); }
  const sw = (await listTargets()).find((t) => t.type === 'service_worker' && t.url.includes('/src/background.js'));
  console.log(`✔ Chrome for Testing started (pid ${child.pid}, port ${PORT})`);
  console.log(sw ? `✔ extension loaded: ${new URL(sw.url).host}` : '✖ extension service worker not found');
} else if (cmd === 'stop') {
  if (existsSync(pidFile)) {
    try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGTERM'); } catch {}
    rmSync(pidFile, { force: true });
  }
  for (let i = 0; i < 20 && (await alive()); i++) await sleep(250);
  console.log((await alive()) ? '✖ still running' : '✔ stopped');
} else {
  if (!(await alive())) { console.log('not running'); process.exit(0); }
  for (const t of await listTargets()) if (t.type === 'page') console.log(`${t.id}  ${t.url}`);
}
