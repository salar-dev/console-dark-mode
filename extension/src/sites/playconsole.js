/**
 * Site adapter — Google Play Console.
 *
 * Play Console already ships a complete Material dark token set, gated on an
 * `.acx-dark-theme` ancestor class that nothing in the UI toggles yet. We
 * switch it on from <html>, which recolours every token-driven surface, and
 * let the engine + static CSS take care of the hard-coded leftovers.
 */
(function (root) {
  'use strict';

  root.StoreDarkSite = Object.freeze({
    key: 'playconsole',

    /** Classes added to <html> while the theme is active. */
    rootClasses: ['acx-dark-theme'],

    /** Elements (optionally inside open shadow roots) whose class is swapped. */
    classSwaps: [],

    palette: {
      bgWhiteL: 0.105, // white → #1b1b1b-ish (matches Google's surface-container-low)
      textMaxL: 0.9,   // #1f1f1f → #e3e3e3 (Google's on-surface)
      borderBaseL: 0.27
    },

    /**
     * Rules the engine must leave alone. Google's own dark rules are already
     * correct; recolouring them would double-map.
     */
    skipSelector(sel) {
      return sel.indexOf('acx-dark-theme') !== -1 || sel.indexOf('dark-mode') !== -1;
    },

    /**
     * SVGs shown through <img>, re-served as recoloured data URLs:
     *  - the header logo, whose "Google Play" wordmark is dark grey (#5F6368)
     *    and unreadable on a dark header → swapped for Google's wordmark white;
     *  - the console's artwork (dashboard "Get started" cards, empty states on
     *    Statistics / Releases / Reviews…): a white canvas with grey-blue
     *    shapes and brand accents → canvas transparent, greys mapped onto dark
     *    tiers, accents kept.
     */
    inlineSvgs: [
      {
        selector: 'a.navigation-menu-logo img[src*=".svg"]',
        fills: { '#5F6368': '#F1F3F4' }
      },
      {
        selector: 'img[src*="/play.console.ui.common.images/"][src*=".svg"]:not([src*="/logos/"])',
        mode: 'illustration'
      },
      {
        // Placeholder icon of apps without artwork: a light-grey tile with a
        // grey glyph. The tile must stay a tile, so it is darkened, not cleared.
        selector: 'img[src*="/play.console.ui.common.images/logos/default_app_icon.svg"]',
        mode: 'illustration',
        palette: { canvasMinL: 1.01 }
      }
    ],

    /** Credit link goes at the end of the console footer's link row(s). */
    badge: {
      slots: [{ path: ['.footer-row.primary'], linkClass: 'footer-item grey-link', mimic: 'a.footer-item' }]
    }
  });
})(typeof self !== 'undefined' ? self : this);
