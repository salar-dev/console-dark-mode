#!/usr/bin/env node
/**
 * Flip the extension's master switch inside the running Chrome (chrome.mjs).
 * The setting is written from an extension page (the popup), which always has
 * chrome.storage access; the idle service worker does not need to be awake.
 *
 *   node scripts/store/toggle.mjs on|off
 */
import { connect, listTargets, sleep } from './cdp.mjs';

const want = process.argv[2];
if (!['on', 'off'].includes(want)) { console.error('usage: toggle.mjs on|off'); process.exit(2); }
const cdp = await connect();
try {
  const ext = (await listTargets()).find((t) => t.url.startsWith('chrome-extension://'));
  const extId = ext ? new URL(ext.url).host : 'geifmdppciciiogmpenelnidmbdejjnb';
  const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/popup/popup.html`, background: true });
  await sleep(600);
  const page = await cdp.page(targetId);
  const now = await page.evaluate(`chrome.storage.sync.set({ enabled: ${want === 'on'} }).then(() => chrome.storage.sync.get('enabled'))`);
  await cdp.send('Target.closeTarget', { targetId });
  console.log(`✔ dark mode ${want} (stored enabled=${now.enabled})`);
} finally {
  cdp.close();
}
