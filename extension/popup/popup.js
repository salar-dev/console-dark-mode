/**
 * Popup controller.
 *
 * Reads settings from chrome.storage.sync, renders the switches, writes
 * changes back, and shows whether the current tab is themed.
 */
(() => {
  'use strict';

  const { SITES, normalize, siteForLocation } = self.StoreDark;

  const SITE_NAMES = {
    [SITES.PLAY_CONSOLE]: 'Google Play Console',
    [SITES.APP_STORE_CONNECT]: 'App Store Connect'
  };

  const STATUS = {
    active: (site) => `Dark mode is on for ${SITE_NAMES[site]}`,
    inactive: () => 'Dark mode is off for this page',
    waiting: () => 'Waiting for system dark mode',
    unsupported: () => 'Open Play Console or App Store Connect'
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    enabled: $('toggle-enabled'),
    playconsole: $('toggle-site-playconsole'),
    appstoreconnect: $('toggle-site-appstoreconnect'),
    follow: $('toggle-follow-system'),
    sitesSection: $('section-sites'),
    status: $('status'),
    statusText: $('status-text'),
    shortcutKey: $('shortcut-key'),
    shortcutChange: $('shortcut-change'),
    version: $('version')
  };

  let settings = normalize(null);
  let currentSite = null; // site of the active tab, or null
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

  /* ---------- Rendering ---------- */
  function setSwitch(el, on) {
    el.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  function render() {
    setSwitch(els.enabled, settings.enabled);
    setSwitch(els.playconsole, settings.sites[SITES.PLAY_CONSOLE]);
    setSwitch(els.appstoreconnect, settings.sites[SITES.APP_STORE_CONNECT]);
    setSwitch(els.follow, settings.followSystem);
    els.sitesSection.classList.toggle('card--dimmed', !settings.enabled);
    renderStatus();
  }

  function renderStatus() {
    let state = 'unsupported';
    if (currentSite) {
      const siteOn = settings.enabled && settings.sites[currentSite];
      if (!siteOn) state = 'inactive';
      else if (settings.followSystem && !prefersDark.matches) state = 'waiting';
      else state = 'active';
    }
    els.status.dataset.state = state;
    els.statusText.textContent = STATUS[state](currentSite);
  }

  /* ---------- Persistence ---------- */
  async function save(patch) {
    settings = normalize({ ...settings, ...patch });
    render(); // optimistic
    await chrome.storage.sync.set(settings);
  }

  const toggleSite = (site) => save({ sites: { ...settings.sites, [site]: !settings.sites[site] } });

  function bind() {
    els.enabled.addEventListener('click', () => save({ enabled: !settings.enabled }));
    els.follow.addEventListener('click', () => save({ followSystem: !settings.followSystem }));
    els.playconsole.addEventListener('click', () => toggleSite(SITES.PLAY_CONSOLE));
    els.appstoreconnect.addEventListener('click', () => toggleSite(SITES.APP_STORE_CONNECT));

    // The whole row is a hit target; clicks that land outside the switch forward to it.
    for (const row of document.querySelectorAll('.row[data-switch]')) {
      row.addEventListener('click', (event) => {
        if (event.target.closest('.switch')) return;
        $(row.dataset.switch).click();
      });
    }

    els.shortcutChange.addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      window.close();
    });

    // Keep in sync if settings change while the popup is open (shortcut, other device).
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const patch = {};
      for (const k of Object.keys(changes)) patch[k] = changes[k].newValue;
      settings = normalize({ ...settings, ...patch });
      render();
    });

    prefersDark.addEventListener('change', renderStatus);
  }

  /* ---------- Current tab / shortcut / version ---------- */
  async function detectCurrentSite() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) currentSite = siteForLocation(new URL(tab.url));
    } catch {
      currentSite = null;
    }
  }

  async function loadShortcut() {
    try {
      const commands = await chrome.commands.getAll();
      const cmd = commands.find((c) => c.name === 'toggle-dark-mode');
      els.shortcutKey.textContent = cmd && cmd.shortcut ? cmd.shortcut : 'Not set';
    } catch {
      /* leave default */
    }
  }

  async function init() {
    els.version.textContent = `v${chrome.runtime.getManifest().version}`;
    const [raw] = await Promise.all([chrome.storage.sync.get(null), detectCurrentSite(), loadShortcut()]);
    settings = normalize(raw);
    bind();
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
