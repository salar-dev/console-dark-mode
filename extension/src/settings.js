/**
 * Shared settings model.
 *
 * Loaded as a classic script in three contexts:
 *   - content scripts  (listed before content.js in the manifest)
 *   - the popup        (<script src="../src/settings.js">)
 *   - the service worker (importScripts)
 *
 * Everything is exposed on `self.StoreDark` so no module syntax is needed.
 */
(function (root) {
  'use strict';

  /** Site identifiers used in storage and as the value of the <html> attribute. */
  const SITES = Object.freeze({
    PLAY_CONSOLE: 'playconsole',
    APP_STORE_CONNECT: 'appstoreconnect'
  });

  /** Attribute set on <html> while the dark theme is active. CSS is scoped to it. */
  const ROOT_ATTR = 'data-store-dark';

  const DEFAULTS = Object.freeze({
    /** Master switch. */
    enabled: true,
    /** Per-site switches. */
    sites: Object.freeze({ [SITES.PLAY_CONSOLE]: true, [SITES.APP_STORE_CONNECT]: true }),
    /** When true, dark theme is applied only while the OS prefers dark. */
    followSystem: false
  });

  /**
   * Merge raw storage data with defaults, dropping anything unexpected so the
   * rest of the code can trust the shape.
   */
  function normalize(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const sites = src.sites && typeof src.sites === 'object' ? src.sites : {};
    return {
      enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULTS.enabled,
      followSystem:
        typeof src.followSystem === 'boolean' ? src.followSystem : DEFAULTS.followSystem,
      sites: {
        [SITES.PLAY_CONSOLE]:
          typeof sites[SITES.PLAY_CONSOLE] === 'boolean'
            ? sites[SITES.PLAY_CONSOLE]
            : DEFAULTS.sites[SITES.PLAY_CONSOLE],
        [SITES.APP_STORE_CONNECT]:
          typeof sites[SITES.APP_STORE_CONNECT] === 'boolean'
            ? sites[SITES.APP_STORE_CONNECT]
            : DEFAULTS.sites[SITES.APP_STORE_CONNECT]
      }
    };
  }

  /**
   * play.google.com hosts several unrelated web apps (the public store, Books,
   * marketing pages…). Only the developer console lives under /console.
   */
  const PLAY_CONSOLE_PATH = /^\/console(\/|$)/;

  /**
   * @param {Location|URL} loc
   * @returns {'playconsole'|'appstoreconnect'|null}
   */
  /** ASC's sign-in page is a cross-origin iframe on a bare page: leave it alone. */
  const ASC_EXCLUDED_PATH = /^\/login(\/|$)/;

  function siteForLocation(loc) {
    const host = (loc.hostname || '').toLowerCase();
    if (host === 'appstoreconnect.apple.com') {
      return ASC_EXCLUDED_PATH.test(loc.pathname || '/') ? null : SITES.APP_STORE_CONNECT;
    }
    if (host === 'play.google.com' && PLAY_CONSOLE_PATH.test(loc.pathname || '/')) {
      return SITES.PLAY_CONSOLE;
    }
    return null;
  }

  root.StoreDark = Object.freeze({ SITES, ROOT_ATTR, DEFAULTS, normalize, siteForLocation });
})(typeof self !== 'undefined' ? self : this);
