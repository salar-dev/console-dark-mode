#!/usr/bin/env node
/**
 * Capture a Chrome Web Store screenshot (default 1280×800, rendered at 2× and
 * downsampled) of a page in the Chrome started by chrome.mjs, optionally after
 * anonymising the page with anon.js.
 *
 *   node scripts/store/shot.mjs --url <url> --out <png> [--anon <map.json>] [--settle 4000]
 *        [--width 1280 --height 800 --dpr 2] [--new] [--reload] [--prep <file.js>] [--eval '<expr>']
 *
 * --anon map.json  { "names": { "Real app": "Fictional app", ... }, "scrambleNumbers": true }
 * --prep file.js   JS run in the page before the shot (statements; may use await)
 * --eval expr      evaluate an expression and print it as JSON
 * --new            always open a fresh tab instead of reusing one on the same origin
 * --nopost         keep the raw 2× PNG (no resize / alpha flattening)
 * --final WxH      resize the result to this size instead of width×height (e.g. capture 1440×900, deliver 1280×800)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { connect, listTargets, sleep } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) args[k] = true; else { args[k] = next; i++; }
}
const width = Number(args.width || 1280);
const height = Number(args.height || 800);
const dpr = Number(args.dpr || 2);
const settle = Number(args.settle || 4000);
if (!args.url && !args.eval) { console.error('usage: --url <url> --out <png> [options]'); process.exit(2); }

const cdp = await connect();
try {
  const pages = (await listTargets()).filter((t) => t.type === 'page');
  let target;
  if (args.url && !args.new) {
    const origin = new URL(args.url).origin;
    target = pages.find((t) => t.url === args.url) || pages.find((t) => t.url.startsWith(origin));
  }
  if (!target && !args.url) target = pages[0];
  let targetId = target?.id;
  if (!targetId) ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
  const page = await cdp.page(targetId);
  await cdp.send('Target.activateTarget', { targetId });

  await page.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
  if (args.url && (target?.url !== args.url || args.reload)) {
    const loaded = page.waitForEvent('Page.loadEventFired', 30000);
    await page.call('Page.navigate', { url: args.url });
    await loaded;
  }
  await sleep(settle);

  const url = await page.evaluate('location.href');
  console.log('page:', url);
  if (/accounts\.google\.com|\/login|idmsa\.apple\.com/.test(url)) {
    console.error('✖ not signed in (landed on a login page)');
    process.exitCode = 3;
  }

  if (args.prep) {
    await page.evaluate(`(async () => { ${readFileSync(resolve(args.prep), 'utf8')} })()`);
    await sleep(800);
  }
  if (args.anon) {
    const map = JSON.parse(readFileSync(resolve(args.anon), 'utf8'));
    const src = readFileSync(join(here, 'anon.js'), 'utf8');
    const report = await page.evaluate(`(${src})(${JSON.stringify(map)})`);
    console.log('anonymised:', JSON.stringify(report));
    if (report.leftovers.length) { console.error('✖ real names still visible:', report.leftovers); process.exitCode = 4; }
    await sleep(600);
  }
  if (args.eval) console.log(JSON.stringify(await page.evaluate(args.eval), null, 2));

  if (args.out) {
    const shot = await page.call('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false, clip: { x: 0, y: 0, width, height, scale: 1 }
    });
    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    writeFileSync(args.out, Buffer.from(shot.data, 'base64'));
    if (args.nopost) console.log('raw:', args.out);
    else execFileSync('python3', [join(here, 'postprocess.py'), args.out, '--size', args.final || `${width}x${height}`], { stdio: 'inherit' });
  }
  if (!args.keep) await page.call('Emulation.clearDeviceMetricsOverride');
} finally {
  cdp.close();
}
