#!/usr/bin/env node
/**
 * End-to-end check for the unpacked extension in headless Chrome / Chromium.
 *
 * Chrome 137+ ignores --load-extension, so the extension is loaded through the
 * DevTools protocol (Extensions.loadUnpacked over --remote-debugging-pipe).
 * A local HTTPS fixture impersonates play.google.com/console; the page reports
 * the computed colours it ends up with, and a screenshot is saved. The popup
 * is opened as an extension page afterwards and screenshotted too.
 *
 *   node scripts/e2e/run.mjs [chrome-binary]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const extDir = join(root, 'extension');
const outDir = process.env.E2E_OUT || join(here, 'out');
mkdirSync(outDir, { recursive: true });

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

const chrome = findChrome();
const port = 8443;
const certDir = join(here, 'certs');
if (!existsSync(join(certDir, 'cert.pem'))) {
  mkdirSync(certDir, { recursive: true });
  execSync(
    `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${join(certDir, 'key.pem')}" -out "${join(certDir, 'cert.pem')}" ` +
      `-days 30 -subj "/CN=play.google.com" -addext "subjectAltName=DNS:play.google.com,DNS:appstoreconnect.apple.com"`,
    { stdio: 'ignore' }
  );
}

const server = spawn('python3', [join(here, 'server.py'), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));

const profile = mkdtempSync(join(tmpdir(), 'sd-e2e-'));
const child = spawn(
  chrome,
  [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    '--ignore-certificate-errors',
    `--host-resolver-rules=MAP play.google.com 127.0.0.1:${port}, MAP appstoreconnect.apple.com 127.0.0.1:${port}`,
    '--window-size=640,520', 'about:blank'
  ],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] }
);
child.stderr.on('data', () => {});

/* ---- minimal CDP-over-pipe client ---- */
const toChrome = child.stdio[3];
const fromChrome = child.stdio[4];
let buf = '';
let nextId = 0;
const pending = new Map();
const listeners = [];
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
    } else {
      for (const fn of listeners) fn(msg);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let exitCode = 0;
try {
  const { id: extId } = await send('Extensions.loadUnpacked', { path: extDir });
  console.log('✔ extension loaded:', extId);

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);

  const url = 'https://play.google.com/console/test/';
  await send('Page.navigate', { url }, sessionId);
  await sleep(2800);

  const { result } = await send(
    'Runtime.evaluate',
    { expression: 'document.getElementById("report").textContent', returnByValue: true },
    sessionId
  );
  const text = String(result.value || '');
  const json = text.startsWith('REPORT ') ? JSON.parse(text.slice(7)) : null;
  console.log(JSON.stringify(json, null, 2));
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(json, null, 2));

  const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(join(outDir, 'screenshot.png'), Buffer.from(shot.data, 'base64'));

  // ---- toggle off/on through the extension's own service worker ----
  const evalPage = async (expr) =>
    (await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId)).result.value;
  const { targetInfos } = await send('Target.getTargets');
  const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://' + extId));
  let toggle = { offAttr: 'n/a', offAdopted: -1, offCard: 'n/a', onAttr: 'n/a', onCard: 'n/a' };
  if (sw) {
    const { sessionId: swSession } = await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
    const setEnabled = (v) =>
      send('Runtime.evaluate', { expression: `chrome.storage.sync.set({ enabled: ${v} })`, awaitPromise: true }, swSession);
    await setEnabled(false);
    await sleep(700);
    toggle.offAttr = await evalPage('document.documentElement.getAttribute("data-store-dark")');
    toggle.offAdopted = await evalPage('document.adoptedStyleSheets.length');
    toggle.offCard = await evalPage('getComputedStyle(document.getElementById("card")).backgroundColor');
    toggle.offClass = await evalPage('document.documentElement.className');
    toggle.offBadge = await evalPage('document.querySelectorAll("[data-store-dark-badge]").length');
    toggle.offLogo = await evalPage('document.getElementById("logo-img").getAttribute("src")');
    toggle.offIllu = await evalPage('document.getElementById("illu-img").getAttribute("src")');
    toggle.offIlluOpacity = await evalPage('getComputedStyle(document.getElementById("illu-img")).opacity');
    await setEnabled(true);
    await sleep(700);
    toggle.onAttr = await evalPage('document.documentElement.getAttribute("data-store-dark")');
    toggle.onCard = await evalPage('getComputedStyle(document.getElementById("card")).backgroundColor');
  }
  console.log('toggle:', JSON.stringify(toggle));

  // ---- popup: renders, brand icons load, a row click toggles + persists ----
  const popup = { brandOk: false, status: '', version: '', clickToggled: false, persisted: null, offDimmed: false, height: 0, errors: [] };
  try {
    const { targetId: popupTarget } = await send('Target.createTarget', { url: `chrome-extension://${extId}/popup/popup.html` });
    const { sessionId: ps } = await send('Target.attachToTarget', { targetId: popupTarget, flatten: true });
    listeners.push((msg) => {
      if (msg.sessionId !== ps) return;
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        popup.errors.push(d.text + ' ' + ((d.exception && d.exception.description) || ''));
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') popup.errors.push(msg.params.entry.text);
    });
    await send('Page.enable', {}, ps);
    await send('Runtime.enable', {}, ps);
    await send('Log.enable', {}, ps);
    await send('Emulation.setDeviceMetricsOverride', { width: 336, height: 480, deviceScaleFactor: 2, mobile: false }, ps);
    await sleep(700);
    const evalPopup = async (expr) =>
      (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, ps)).result.value;
    popup.brandOk = await evalPopup(
      'document.querySelectorAll("img.row__brand").length === 2 && [...document.querySelectorAll("img.row__brand")].every(i => i.complete && i.naturalWidth > 0)'
    );
    popup.status = await evalPopup('document.getElementById("status-text").textContent');
    popup.version = await evalPopup('document.getElementById("version").textContent');
    await evalPopup('document.getElementById("label-play").click()'); // on the text, not the switch
    await sleep(300);
    popup.clickToggled = (await evalPopup('document.getElementById("toggle-site-playconsole").getAttribute("aria-checked")')) === 'false';
    popup.persisted = await evalPopup('chrome.storage.sync.get("sites").then(r => r.sites.playconsole)');
    await evalPopup('document.getElementById("toggle-site-playconsole").click()'); // restore
    await sleep(250);
    popup.height = await evalPopup('Math.ceil(document.querySelector(".popup").getBoundingClientRect().height)');
    await send('Emulation.setDeviceMetricsOverride', { width: 336, height: popup.height, deviceScaleFactor: 2, mobile: false }, ps);
    await sleep(200);
    const pshot = await send('Page.captureScreenshot', { format: 'png' }, ps);
    writeFileSync(join(outDir, 'popup.png'), Buffer.from(pshot.data, 'base64'));
    // master switch off: the sites card dims, the popup keeps working
    await evalPopup('chrome.storage.sync.set({ enabled: false })');
    await sleep(300);
    popup.offDimmed = await evalPopup('document.getElementById("section-sites").classList.contains("card--dimmed") && document.getElementById("toggle-enabled").getAttribute("aria-checked") === "false"');
    const offShot = await send('Page.captureScreenshot', { format: 'png' }, ps);
    writeFileSync(join(outDir, 'popup-off.png'), Buffer.from(offShot.data, 'base64'));
    await evalPopup('chrome.storage.sync.set({ enabled: true })');
    await sleep(200);
  } catch (err) {
    popup.errors.push('popup: ' + err.message);
  }
  console.log('popup:', JSON.stringify(popup));

  // ---- assertions ----
  const isDark = (rgb) => {
    const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb || '');
    return m && (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 < 110;
  };
  const isLight = (rgb) => {
    const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb || '');
    return m && (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 > 150;
  };
  // fill of the fixture illustration's element with this id (id precedes fill in the fixture)
  const fillOf = (svg, id) => {
    const m = new RegExp('<[^>]*\\bid="' + id + '"[^>]*\\bfill="([^"]+)"', 'i').exec(svg || '');
    return m ? m[1].toLowerCase() : '';
  };
  const strokeOf = (svg, id) => {
    const m = new RegExp('<[^>]*\\bid="' + id + '"[^>]*\\bstroke="([^"]+)"', 'i').exec(svg || '');
    return m ? m[1].toLowerCase() : '';
  };
  const hexMean = (hex) => {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '');
    return m ? (parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16)) / 3 : NaN;
  };
  const illu = json ? json.illuSrc : '';
  const tiers = { inner: hexMean(fillOf(illu, 'inner')), light: hexMean(fillOf(illu, 'light')), mid: hexMean(fillOf(illu, 'mid')), line: hexMean(strokeOf(illu, 'line')) };
  const checks = json
    ? [
        ['attribute set', json.attr === 'playconsole'],
        ['root class added', /\bacx-dark-theme\b/.test(json.htmlClass)],
        ['body background dark', isDark(json.bodyBg)],
        ['card background dark', isDark(json.card.split(' / ')[0])],
        ['card text light', isLight(json.card.split(' / ')[1])],
        ['accent button kept', json.accent === 'rgb(11, 87, 208)'],
        ['tonal chip dark', isDark(json.tonal.split(' / ')[0])],
        ['@media rule remapped', isDark(json.media)],
        ['external css remapped', isDark(json.ext.split(' / ')[0])],
        ['inline accent colour untouched', json.inline === 'rgb(1, 200, 3)'],
        ['inline white surface remapped', isDark(json.inlineWhite.split(' / ')[0]) && isLight(json.inlineWhite.split(' / ')[1])],
        ['inline border remapped', isDark(json.inlineWhite.split(' / ')[2])],
        ['inline style set later by JS remapped', isDark(json.inlineLate)],
        ['grey svg fill attribute lightened', isLight(json.glyphGrey)],
        ['coloured svg fill attribute kept', json.glyphColor === 'rgb(0, 112, 201)'],
        ['runtime insertRule remapped', isDark(json.runtime.split(' / ')[0])],
        ['CSSOM insert remapped within the same task (page hook)', isDark(json.lateImmediate)],
        ['shadow root remapped', isDark(json.shadow.split(' / ')[0])],
        ['constructed sheet used (no <style> fallback)', json.adopted >= 1 && json.engineStyleEls === 0],
        ['credit link mounted once in the footer', json.badgeCount === 1 && json.badgeHref === 'https://github.com/salar-dev' && json.badgeText === 'Dark Mode By: Salar Dev'],
        ['logo re-served with white wordmark, blue kept, image loads', /fill="#F1F3F4"/.test(json.logoSrc) && /fill="#2F80ED"/.test(json.logoSrc) && !/#5F6368/i.test(json.logoSrc) && json.logoLoaded],
        ['illustration: white canvas made transparent', (illu.match(/<path fill="none" d="M0 0h800v800H0z"\/>/g) || []).length === 2],
        ['illustration: greys fan out as dark tiers (white < light < line < mid), nothing white left',
          tiers.inner < 40 && tiers.inner < tiers.light && tiers.light < tiers.line && tiers.line < tiers.mid && tiers.mid < 170 && !/#fff\b|#eceff1|#ced8dd|#afbec6/i.test(illu)],
        ['illustration: brand accent kept, dark ink lightened, translucent shadow untouched',
          fillOf(illu, 'accent') === '#4285f4' && hexMean(fillOf(illu, 'ink')) > 150 && fillOf(illu, 'shadow') === '#00000033'],
        ['illustration: image decodes and is visible', json.illuLoaded && json.illuOpacity === '1'],
        ['service worker reachable', !!sw],
        ['toggle off: original logo src restored verbatim', /(?:^|\/)logo\.svg$/.test(toggle.offLogo || '')],
        ['toggle off: original illustration restored and visible', /\/getting_started\/sample\.svg$/.test(toggle.offIllu || '') && toggle.offIlluOpacity === '1'],
        ['toggle off: credit link removed', toggle.offBadge === 0],
        ['toggle off: attribute removed', toggle.offAttr === null],
        ['toggle off: root class removed', !/\bacx-dark-theme\b/.test(toggle.offClass || '')],
        ['toggle off: engine sheet detached', toggle.offAdopted === 0],
        ['toggle off: card back to white', toggle.offCard === 'rgb(255, 255, 255)'],
        ['toggle on: dark again', toggle.onAttr === 'playconsole' && isDark(toggle.onCard)],
        ['popup: both brand icons load', popup.brandOk],
        ['popup: status for a non-console tab', popup.status === 'Open Play Console or App Store Connect'],
        ['popup: version shown', /^v\d+\.\d+\.\d+$/.test(popup.version)],
        ['popup: clicking a row toggles its switch and persists', popup.clickToggled && popup.persisted === false],
        ['popup: master off reflected live (switch off, sites dimmed)', popup.offDimmed],
        ['popup: no errors', popup.errors.length === 0]
      ]
    : [['page reported', false]];
  for (const [name, ok] of checks) {
    console.log(`${ok ? '  ✔' : '  ✘'} ${name}`);
    if (!ok) exitCode = 1;
  }
} catch (err) {
  console.error('✘ e2e failed:', err.message);
  exitCode = 1;
} finally {
  child.kill();
  await new Promise((r) => child.once('exit', r));
  server.kill();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(exitCode);
