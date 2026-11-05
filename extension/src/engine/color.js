/**
 * Tiny colour toolkit used by the theming engine.
 *
 * Parses the colour syntaxes the CSSOM actually serialises (rgb()/rgba(),
 * hex, a handful of named colours), converts to HSL and back, and finds
 * colour tokens inside compound values such as gradients and box-shadows.
 *
 * Exposed on `self.StoreDarkColor` (classic script, no modules).
 */
(function (root) {
  'use strict';

  const NAMED = {
    white: [255, 255, 255], black: [0, 0, 0], gray: [128, 128, 128], grey: [128, 128, 128],
    silver: [192, 192, 192], whitesmoke: [245, 245, 245], gainsboro: [220, 220, 220],
    lightgray: [211, 211, 211], lightgrey: [211, 211, 211], darkgray: [169, 169, 169],
    darkgrey: [169, 169, 169], dimgray: [105, 105, 105], dimgrey: [105, 105, 105],
    red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], yellow: [255, 255, 0],
    orange: [255, 165, 0], purple: [128, 0, 128], navy: [0, 0, 128], teal: [0, 128, 128],
    aqua: [0, 255, 255], cyan: [0, 255, 255], magenta: [255, 0, 255], fuchsia: [255, 0, 255],
    lime: [0, 255, 0], maroon: [128, 0, 0], olive: [128, 128, 0], pink: [255, 192, 203],
    brown: [165, 42, 42], lightblue: [173, 216, 230], lightyellow: [255, 255, 224],
    ivory: [255, 255, 240], snow: [255, 250, 250], linen: [250, 240, 230], beige: [245, 245, 220],
    azure: [240, 255, 255], aliceblue: [240, 248, 255], ghostwhite: [248, 248, 255],
    honeydew: [240, 255, 240], mintcream: [245, 255, 250], seashell: [255, 245, 238],
    lavender: [230, 230, 250], floralwhite: [255, 250, 240], oldlace: [253, 245, 230]
  };

  const NAMED_ALT = Object.keys(NAMED).join('|');

  /**
   * Matches every colour token we know how to parse. Relative colour syntax
   * (`rgb(from …)`) and `color(srgb …)` deliberately do not match: they are
   * either token-driven already or too exotic to remap safely.
   */
  const TOKEN_RE = new RegExp(
    'rgba?\\(\\s*[\\d.]+%?\\s*[, ]\\s*[\\d.]+%?\\s*[, ]\\s*[\\d.]+%?\\s*(?:[,/]\\s*[\\d.]+%?\\s*)?\\)' +
      '|#[0-9a-f]{3,8}\\b' +
      '|\\b(?:' + NAMED_ALT + ')\\b',
    'gi'
  );

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /** @returns {{r:number,g:number,b:number,a:number}|null} */
  function parse(token) {
    const t = String(token).trim().toLowerCase();
    if (!t) return null;

    if (t[0] === '#') {
      const hex = t.slice(1);
      if (!/^[0-9a-f]+$/.test(hex)) return null;
      let r, g, b, a = 1;
      if (hex.length === 3 || hex.length === 4) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
        if (hex.length === 4) a = parseInt(hex[3] + hex[3], 16) / 255;
      } else if (hex.length === 6 || hex.length === 8) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
        if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16) / 255;
      } else {
        return null;
      }
      return { r, g, b, a };
    }

    if (t.startsWith('rgb')) {
      const open = t.indexOf('(');
      const close = t.lastIndexOf(')');
      if (open < 0 || close < 0) return null;
      const parts = t.slice(open + 1, close).split(/[\s,/]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const chan = (p) => (p.endsWith('%') ? parseFloat(p) * 2.55 : parseFloat(p));
      const r = chan(parts[0]);
      const g = chan(parts[1]);
      const b = chan(parts[2]);
      let a = 1;
      if (parts[3] !== undefined) a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
      if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
      return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a, 0, 1) };
    }

    if (NAMED[t]) {
      const [r, g, b] = NAMED[t];
      return { r, g, b, a: 1 };
    }
    return null;
  }

  /** @returns {{h:number,s:number,l:number}} h in [0,360), s/l in [0,1] */
  function toHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s, l };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 1); l = clamp(l, 0, 1);
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const hk = h / 360;
    return [hue2rgb(hk + 1 / 3), hue2rgb(hk), hue2rgb(hk - 1 / 3)].map((v) => Math.round(v * 255));
  }

  /** Serialise to the same syntax the CSSOM uses. */
  function format(r, g, b, a) {
    r = Math.round(r); g = Math.round(g); b = Math.round(b);
    if (a === undefined || a >= 0.999) return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
  }

  function fromHsl(h, s, l, a) {
    const [r, g, b] = hslToRgb(h, s, l);
    return format(r, g, b, a);
  }

  /**
   * Replace every colour token inside a compound value using `fn(parsed, token)`.
   * `fn` returns a replacement string or null to keep the token.
   */
  function replaceTokens(value, fn) {
    let changed = false;
    const out = value.replace(TOKEN_RE, (token) => {
      const c = parse(token);
      if (!c) return token;
      const next = fn(c, token);
      if (next && next !== token) {
        changed = true;
        return next;
      }
      return token;
    });
    return changed ? out : null;
  }

  root.StoreDarkColor = Object.freeze({ parse, toHsl, fromHsl, format, replaceTokens, clamp, TOKEN_RE });
})(typeof self !== 'undefined' ? self : this);
