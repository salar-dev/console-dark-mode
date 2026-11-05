/**
 * Site adapter — App Store Connect.
 *
 * ASC's component library ("tb-*") carries a full dark theme under `html.dark`,
 * and the shared Apple header/footer web components have `.dark` variants of
 * their own inside their shadow roots. We turn those on, then the engine
 * recolours the styled-components / CSS-modules layer that has no dark rules.
 */
(function (root) {
  'use strict';

  root.StoreDarkSite = Object.freeze({
    key: 'appstoreconnect',

    rootClasses: ['dark'],

    classSwaps: [
      { path: ['amp-nav', '#_m_header'], from: 'light', to: 'dark' },
      { path: ['amp-footer', '#_m_footer'], from: 'light', to: 'dark' }
    ],

    palette: {
      bgWhiteL: 0.118, // white → #1e1e1e (Apple's own html.dark background)
      textMaxL: 0.96,  // #111 → #f5f5f7
      borderBaseL: 0.25
    },

    skipSelector(sel) {
      // Apple's own dark rules (html.dark …, header.primary-header.dark …).
      return /(^|[\s,])html\.dark\b|\.dark\b/.test(sel);
    },

    /** Credit link becomes one more item in the footer web component's link list. */
    badge: {
      slots: [
        {
          path: ['amp-footer', '#_m_links'],
          wrap: 'li',
          wrapAttrs: { 'data-footer-link': '' },
          linkAttrs: { part: 'footer-link' }
        }
      ]
    }
  });
})(typeof self !== 'undefined' ? self : this);
