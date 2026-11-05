/**
 * Recolouring for SVGs the page shows through <img src="….svg">.
 *
 * CSS cannot reach inside an <img>, so for the images a site adapter lists
 * (`inlineSvgs`) the SVG file is fetched — the same URL the page already
 * loaded, so it comes from the HTTP cache — recoloured in its *text*, and the
 * image's `src` is pointed at the result as a data URL. Two modes, which can
 * be combined:
 *
 *   fills: { '#5F6368': '#F1F3F4' }   exact swaps (logos, wordmarks)
 *   mode: 'illustration'              automatic: the white canvas becomes
 *                                     transparent, neutral greys are mapped
 *                                     onto dark-surface tiers (light → dark,
 *                                     dark → light) and brand accents are
 *                                     kept, so the artwork reads on a dark
 *                                     card the way it did on a white one
 *
 * No markup is ever parsed or injected — Play Console enforces Trusted Types,
 * which forbids DOMParser/innerHTML — and an SVG loaded through <img> cannot
 * run scripts. While an image is being recoloured it is kept invisible (a
 * constructed stylesheet sets opacity 0) so the light original never flashes;
 * if the fetch fails it is shown as served. Switching the theme off restores
 * every original `src` and detaches that stylesheet.
 */
(function (root) {
  'use strict';

  const ATTR_DONE = 'data-store-dark-replaced';   // src is our data URL
  const ATTR_ORIG = 'data-store-dark-src';        // original URL, for restore
  const ATTR_PENDING = 'data-store-dark-pending'; // fetch / decode in progress
  const ATTR_SKIP = 'data-store-dark-skip';       // could not recolour: show as served

  const Color = root.StoreDarkColor;

  const cache = new Map();      // url -> Promise<string|null>
  const inflight = new WeakSet();
  const touched = new Set();
  let epoch = 0;                // bumped by remove(); in-flight work then bails
  let hideSheet = null;
  let hideSheetKey = '';

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function fetchSvg(url) {
    if (!cache.has(url)) {
      cache.set(
        url,
        fetch(url, { mode: 'cors', credentials: 'omit' })
          .then((r) => (r.ok ? r.text() : null))
          .catch(() => null)
      );
    }
    return cache.get(url);
  }

  /* ---- mode 1: exact fills ------------------------------------------------ */

  function recolorText(svgText, fills) {
    let out = svgText;
    for (const from of Object.keys(fills || {})) {
      const to = fills[from];
      // fill="#5F6368" | fill='#5F6368' | style="fill:#5F6368" | fill: #5F6368;
      const re = new RegExp('(fill\\s*[:=]\\s*["\']?\\s*)' + escapeRe(from) + '(?![0-9a-f])', 'gi');
      out = out.replace(re, '$1' + to);
    }
    return out;
  }

  /* ---- mode 2: illustrations --------------------------------------------- */

  const DEFAULTS = Object.freeze({
    bgL: 0.11,        // lightness white shapes land on (the themed card colour)
    textMaxL: 0.9,    // lightness black ink lands on
    spread: 1.5,      // how far the grey tiers fan out above bgL
    maxChroma: 0.15,  // anything more colourful is a brand accent: keep
    canvasMinL: 0.8   // a full-size shape at least this light is the canvas
  });

  // fill="#fff" | stroke='white' | style="fill:#fff" | stop-color="rgb(…)"
  const PAINT_RE =
    /(?<![\w-])((?:fill|stroke|stop-color|flood-color|lighting-color)\s*[:=]\s*["']?\s*)(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|[a-z]+)/gi;

  const chromaOf = (c) => (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;

  function hexOf(c) {
    const hex = '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    return c.a < 0.999 ? hex + Math.round(c.a * 255).toString(16).padStart(2, '0') : hex;
  }

  /** Neutral → its dark-theme counterpart; accents and translucent paint → null (keep). */
  function mapIllustrationColor(c, P) {
    if (c.a < 0.999 || chromaOf(c) > P.maxChroma) return null;
    const { h, s, l } = Color.toHsl(c);
    const L = l >= 0.5
      ? P.bgL + (1 - l) * P.spread   // white → card colour, light greys → dark tiers above it
      : P.textMaxL - l * 0.6;        // dark ink → light ink
    return hexOf(Color.parse(Color.fromHsl(h, Math.min(s, 0.12), Color.clamp(L, 0, 1))));
  }

  function viewBoxOf(svg) {
    const tag = /<svg\b[^>]*>/i.exec(svg);
    if (!tag) return null;
    const vb = /\bviewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)/i.exec(tag[0]);
    if (vb) return { x: +vb[1], y: +vb[2], w: +vb[3], h: +vb[4] };
    const w = /(?<![\w-])width\s*=\s*["']?\s*([\d.]+)/i.exec(tag[0]);
    const h = /(?<![\w-])height\s*=\s*["']?\s*([\d.]+)/i.exec(tag[0]);
    return w && h ? { x: 0, y: 0, w: +w[1], h: +h[1] } : null;
  }

  function attrOf(tag, name) {
    const m = new RegExp('(?<![\\w-])' + name + '\\s*=\\s*(["\'])([^"\']*)\\1', 'i').exec(tag);
    return m ? m[2] : null;
  }

  function paintOf(tag, prop) {
    const style = attrOf(tag, 'style');
    if (style) {
      const m = new RegExp('(?<![\\w-])' + prop + '\\s*:\\s*([^;]+)', 'i').exec(style);
      if (m) return m[1].trim();
    }
    return attrOf(tag, prop);
  }

  /** True for a <rect>/<path> that paints the whole viewBox (the artwork's canvas). */
  function coversCanvas(tag, vb) {
    if (/^<rect/i.test(tag)) {
      const w = attrOf(tag, 'width');
      const h = attrOf(tag, 'height');
      if (w === '100%' && h === '100%') return true;
      const x = +(attrOf(tag, 'x') || 0);
      const y = +(attrOf(tag, 'y') || 0);
      return x <= vb.x && y <= vb.y && x + +w >= vb.x + vb.w && y + +h >= vb.y + vb.h;
    }
    if (vb.x !== 0 || vb.y !== 0) return false;
    const d = (attrOf(tag, 'd') || '').replace(/[\s,]+/g, '').replace(/Z$/, 'z');
    const W = String(vb.w);
    const H = String(vb.h);
    return [
      `M00h${W}v${H}H0z`, `M00h${W}v${H}h-${W}z`, `M00H${W}V${H}H0z`,
      `M00v${H}h${W}v-${H}z`, `M00V${H}H${W}V0z`,
      `M00L${W}0L${W}${H}L0${H}z`, `M00l${W}0l0${H}l-${W}0z`
    ].indexOf(d) !== -1;
  }

  function clearFill(tag) {
    return tag
      .replace(/(?<![\w-])fill\s*=\s*(["'])[^"']*\1/i, 'fill="none"')
      .replace(/((?<![\w-])fill\s*:\s*)[^;"']+/i, '$1none');
  }

  function recolorIllustration(svgText, palette) {
    const P = Object.assign({}, DEFAULTS, palette || {});
    const vb = viewBoxOf(svgText);
    let out = svgText;
    if (vb) {
      out = out.replace(/<(?:path|rect)\b[^>]*>/gi, (tag) => {
        if (!coversCanvas(tag, vb)) return tag;
        const c = Color.parse(paintOf(tag, 'fill') || '');
        if (!c || c.a < 0.999 || chromaOf(c) > P.maxChroma || Color.toHsl(c).l < P.canvasMinL) return tag;
        return clearFill(tag);
      });
    }
    return out.replace(PAINT_RE, (m, pre, tok) => {
      const c = Color.parse(tok);
      const next = c ? mapIllustrationColor(c, P) : null;
      return next ? pre + next : m;
    });
  }

  /* ---- applying to <img> --------------------------------------------------- */

  function paletteFor(config, spec) {
    const base = (config && config.palette) || {};
    const P = {};
    if (typeof base.bgWhiteL === 'number') P.bgL = base.bgWhiteL;
    if (typeof base.textMaxL === 'number') P.textMaxL = base.textMaxL;
    return Object.assign(P, spec.palette || {});
  }

  function transform(text, spec, config) {
    let out = text;
    if (spec.fills) out = recolorText(out, spec.fills);
    if (spec.mode === 'illustration') out = recolorIllustration(out, paletteFor(config, spec));
    return out;
  }

  async function recolorImage(img, spec, config) {
    // The attribute, not currentSrc: right after a restore currentSrc still
    // names the previous (data) URL for a task, which would stall the redo.
    const current = img.getAttribute('src') || img.currentSrc || img.src || '';
    const src = /^data:/i.test(current) ? img.getAttribute(ATTR_ORIG) : current;
    if (!src) {
      img.setAttribute(ATTR_SKIP, ''); // someone else's data URL: leave it visible
      return;
    }
    const myEpoch = epoch;
    img.setAttribute(ATTR_PENDING, '');
    try {
      const text = await fetchSvg(src);
      if (myEpoch !== epoch || !img.isConnected) return;
      const out = text ? transform(text, spec, config) : null;
      if (!out || out === text) {
        img.setAttribute(ATTR_SKIP, '');
        return;
      }
      const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out);
      img.setAttribute(ATTR_ORIG, src);
      img.src = dataUrl;
      touched.add(img);
      let decoded = true;
      try { await img.decode(); } catch (_) { decoded = false; }
      if (myEpoch !== epoch) return;
      if (img.getAttribute('src') !== dataUrl) return; // the page moved on; ensure() will revisit
      if (decoded) {
        img.setAttribute(ATTR_DONE, '');
      } else {
        img.src = src;                 // our output did not decode: fall back to the original
        img.removeAttribute(ATTR_ORIG);
        img.setAttribute(ATTR_SKIP, '');
      }
    } finally {
      img.removeAttribute(ATTR_PENDING);
    }
  }

  /** Keeps matched images invisible until their dark version is in place. */
  function attachHideSheet(config) {
    const key = config.inlineSvgs.map((s) => s.selector).join('\n');
    if (!hideSheet || hideSheetKey !== key) {
      let sheet;
      try {
        sheet = new CSSStyleSheet();
        const sel = config.inlineSvgs
          .map((s) => `${s.selector}:not([${ATTR_DONE}]):not([${ATTR_SKIP}])`)
          .concat([`img[${ATTR_PENDING}]`])
          .join(',\n');
        sheet.replaceSync(`${sel} { opacity: 0 !important; }`);
      } catch (_) {
        return;
      }
      detachHideSheet();
      hideSheet = sheet;
      hideSheetKey = key;
    }
    if (document.adoptedStyleSheets.indexOf(hideSheet) === -1) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.concat(hideSheet);
    }
  }

  function detachHideSheet() {
    if (!hideSheet) return;
    if (document.adoptedStyleSheets.indexOf(hideSheet) !== -1) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== hideSheet);
    }
  }

  /** Cheap; safe to call on every mutation. Re-applies if the page reset a src. */
  function ensure(config) {
    if (!config || !config.inlineSvgs || !config.inlineSvgs.length) return;
    attachHideSheet(config);
    for (const spec of config.inlineSvgs) {
      for (const img of document.querySelectorAll(spec.selector)) {
        if (inflight.has(img) || img.hasAttribute(ATTR_SKIP)) continue;
        if (img.hasAttribute(ATTR_DONE)) {
          if (/^data:/i.test(img.getAttribute('src') || '')) continue;
          img.removeAttribute(ATTR_DONE); // the page reset the src: redo from the new URL
          img.removeAttribute(ATTR_ORIG);
        }
        inflight.add(img);
        recolorImage(img, spec, config).finally(() => inflight.delete(img));
      }
    }
    for (const img of touched) if (!img.isConnected) touched.delete(img);
  }

  function restore(img) {
    const orig = img.getAttribute(ATTR_ORIG);
    if (orig && /^data:/i.test(img.getAttribute('src') || '')) img.src = orig;
    img.removeAttribute(ATTR_ORIG);
    img.removeAttribute(ATTR_DONE);
    img.removeAttribute(ATTR_PENDING);
    img.removeAttribute(ATTR_SKIP);
  }

  function remove() {
    epoch++;
    detachHideSheet();
    for (const img of touched) restore(img);
    touched.clear();
    const sel = [ATTR_DONE, ATTR_ORIG, ATTR_PENDING, ATTR_SKIP].map((a) => `[${a}]`).join(',');
    for (const img of document.querySelectorAll(sel)) restore(img);
  }

  root.StoreDarkSvg = Object.freeze({
    ensure, remove, recolorText, recolorIllustration,
    ATTR_DONE, ATTR_ORIG, ATTR_PENDING, ATTR_SKIP
  });
})(typeof self !== 'undefined' ? self : this);
