/**
 * Service worker.
 *
 * Responsibilities (kept deliberately small):
 *   1. Seed default settings on install / upgrade.
 *   2. Reflect the master switch in the toolbar icon (dimmed when off).
 *   3. Handle the keyboard shortcut that toggles the master switch.
 */
importScripts('/src/settings.js');

const { normalize } = self.StoreDark;

const ICONS_ON = { 16: '/icons/icon16.png', 32: '/icons/icon32.png', 48: '/icons/icon48.png', 128: '/icons/icon128.png' };
const ICONS_OFF = { 16: '/icons/icon16-off.png', 32: '/icons/icon32-off.png', 48: '/icons/icon48-off.png', 128: '/icons/icon128-off.png' };

async function readSettings() {
  const raw = await chrome.storage.sync.get(null);
  return normalize(raw);
}

async function reflectIcon(enabled) {
  try {
    await chrome.action.setIcon({ path: enabled ? ICONS_ON : ICONS_OFF });
  } catch (err) {
    // Non-fatal: the icon is purely cosmetic.
    console.warn('[Store Dark] setIcon failed', err);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await readSettings();
  await chrome.storage.sync.set(settings); // writes back a complete, normalized object
  await reflectIcon(settings.enabled);
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await readSettings();
  await reflectIcon(settings.enabled);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.enabled) reflectIcon(changes.enabled.newValue !== false);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-dark-mode') return;
  const settings = await readSettings();
  await chrome.storage.sync.set({ enabled: !settings.enabled });
});
