/**
 * Dynamic theming engine.
 *
 * Both consoles ship hashed / build-specific class names (styled-components
 * on App Store Connect, Angular `_ngcontent-*` attributes on Play Console),
 * so hand-written selectors rot quickly. Instead of guessing selectors, this
 * engine reads the page's *own* stylesheets through the CSSOM and emits a
 * dark counterpart for every rule that sets a light colour — same selector,
 * same media conditions, remapped colours. The result is attached as a
 * constructed stylesheet (document.adoptedStyleSheets, which the cascade
 * places after the page's own sheets), so it wins ties by order without
 * needing `!important`, and inline styles keep their original colours.
 *
 * It keeps itself up to date: new <style>/<link> nodes, rules inserted via
 * CSSOM (styled-components does this in production), and open shadow roots
 * are all picked up. Removing the sheet restores the page instantly.
 *
 * Nothing here touches chrome.* APIs, so it can be exercised in a plain page.
 * Exposed on `self.StoreDarkRemapper`.
 */
(function (root) {
  'use strict';

  const Color = root.StoreDarkColor;

  const PROP_KIND = {
    'background-color': 'bg',
    'background-image': 'bgImage',
    'color': 'text',
    'fill': 'text',
    'stroke': 'text',
    'caret-color': 'text',
    '-webkit-text-fill-color': 'text',
    'text-decoration-color': 'text',
    'border-top-color': 'border',
    'border-right-color': 'border',
    'border-bottom-color': 'border',
    'border-left-color': 'border',
    'outline-color': 'border',
    'column-rule-color': 'border',
    'box-shadow': 'shadow',
    'text-shadow': 'shadow'
  };

  const SKIP_VALUE = /currentcolor|\b(?:inherit|initial|unset|revert|none|transparent)\b/i;

  const DEFAULT_PALETTE = {
    /** Lightness that pure white backgrounds map to. */
    bgWhiteL: 0.11,
    /** Upper lightness for body text (what near-black text maps to). */
    textMaxL: 0.92,
    /** Base lightness for hairlines / light borders. */
    borderBaseL: 0.24
  };

  /* ------------------------------------------------------------------ */
  /* Colour mapping                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * HSL "saturation" is misleading for near-white tints: #f8fafd has s=0.55
   * but is visually grey. Chroma (max-min of RGB) tracks perceived colourfulness.
   */
  function chromaOf(c) {
    return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
  }

  function isAccent(chroma, l) {
    // Colourful and not very light: brand / status colours that must survive.
    return chroma > 0.35 && l < 0.78;
  }

  function mapBackground(c, P) {
    const { h, s, l } = Color.toHsl(c);
    const chroma = chromaOf(c);
    if (c.a < 0.999) {
      if (c.a < 0.02) return null;
      // Dark ink overlays (hover states) become light ink; light veils become dark veils.
      if (l < 0.5) return Color.fromHsl(0, 0, 1, Math.min(0.5, c.a * 1.25));
      return Color.fromHsl(h, Math.min(chroma * 2, 0.3), Math.min(l, 0.08), c.a);
    }
    if (l < 0.5 || isAccent(chroma, l)) return null;
    const s2 = Color.clamp(chroma * 4, 0, 0.45);
    const l2 = P.bgWhiteL + (1 - l) * 0.55 + chroma * 0.15;
    return Color.fromHsl(h, s2, l2, 1);
  }

  function mapText(c, P) {
    const { h, s, l } = Color.toHsl(c);
    const chroma = chromaOf(c);
    if (c.a < 0.999) {
      if (c.a < 0.02) return null;
      if (l < 0.5) return Color.fromHsl(0, 0, 1, Math.min(0.95, c.a + 0.1));
      return null;
    }
    if (chroma > 0.25 && l < 0.65) {
      // Links and status text: keep the hue, lift it so it reads on dark.
      return Color.fromHsl(h, Math.min(s, 0.95), Color.clamp(1 - l + 0.08, 0.6, 0.8), 1);
    }
    if (l <= 0.5) return Color.fromHsl(h, Math.min(s, 0.2), P.textMaxL - l * 0.6, 1);
    if (l < 0.72) return Color.fromHsl(h, Math.min(s, 0.5), l + 0.12, 1);
    return null;
  }

  function mapBorder(c, P) {
    const { h, s, l } = Color.toHsl(c);
    const chroma = chromaOf(c);
    if (c.a < 0.999) {
      if (c.a < 0.02) return null;
      if (l < 0.5) return Color.fromHsl(0, 0, 1, Math.min(0.5, c.a * 1.4));
      return Color.fromHsl(h, Math.min(chroma * 2, 0.3), 0.22, c.a);
    }
    if (l > 0.97 && chroma < 0.05) return mapBackground(c, P); // white borders: blend into the surface
    if (isAccent(chroma, l)) return null;
    const s2 = Color.clamp(chroma * 3, 0, 0.3);
    if (l >= 0.5) return Color.fromHsl(h, s2, P.borderBaseL + (1 - l) * 0.5, 1);
    return Color.fromHsl(h, s2, Color.clamp(1 - l, 0.4, 0.55), 1);
  }

  function mapShadowToken(c, P, inset) {
    const { l } = Color.toHsl(c);
    const chroma = chromaOf(c);
    if (c.a < 0.02) return null;
    if (inset && l > 0.5 && c.a >= 0.999 && !isAccent(chroma, l)) return mapBorder(c, P); // inset hairlines
    if (l < 0.5) return Color.format(0, 0, 0, Math.min(0.85, c.a < 0.999 ? c.a * 1.6 : 0.6));
    return Color.format(0, 0, 0, Math.min(0.7, c.a < 0.999 ? c.a * 1.6 : 0.5));
  }

  /**
   * Custom properties that hold a bare colour are remapped by what their
   * name says they are for. Anything ambiguous is left alone.
   */
  const VAR_TEXT = /(?:^|-)(?:on-[a-z]|text|foreground|fg|link|ink|label|icon)/i;
  const VAR_BORDER = /(?:^|-)(?:outline|border|divider|hairline|stroke|separator|keyline)/i;
  const VAR_BG = /(?:^|-)(?:background|bg|surface|container|canvas|fill|panel|card|sheet)/i;

  function kindForCustomProperty(name) {
    if (VAR_TEXT.test(name)) return 'text';
    if (VAR_BORDER.test(name)) return 'border';
    if (VAR_BG.test(name)) return 'bg';
    return null;
  }

  function mapValue(kind, value, P) {
    if (value.indexOf('var(') !== -1) return null;
    if (SKIP_VALUE.test(value) && kind !== 'bgImage' && kind !== 'shadow') return null;
    switch (kind) {
      case 'bg':
        return Color.replaceTokens(value, (c) => mapBackground(c, P));
      case 'text':
        return Color.replaceTokens(value, (c) => mapText(c, P));
      case 'border':
        return Color.replaceTokens(value, (c) => mapBorder(c, P));
      case 'bgImage':
        if (/url\(/i.test(value)) return null;
        return Color.replaceTokens(value, (c) => mapBackground(c, P));
      case 'shadow': {
        const inset = /\binset\b/i.test(value);
        return Color.replaceTokens(value, (c) => mapShadowToken(c, P, inset));
      }
      default:
        return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Rule compilation                                                    */
  /* ------------------------------------------------------------------ */

  function compileDeclarations(style, P, skipProp) {
    let out = '';
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      let kind = PROP_KIND[prop];
      if (!kind && prop.charCodeAt(0) === 45 && prop.charCodeAt(1) === 45) {
        kind = kindForCustomProperty(prop); // --custom-property holding a colour
      }
      if (!kind) continue;
      if (skipProp && skipProp(prop)) continue;
      const value = style.getPropertyValue(prop).trim();
      if (!value) continue;
      if (kind && prop.charCodeAt(0) === 45 && !/^(?:rgba?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)$/i.test(value)) continue;
      const mapped = mapValue(kind, value, P);
      if (!mapped) continue;
      const priority = style.getPropertyPriority(prop) ? ' !important' : '';
      out += prop + ':' + mapped + priority + ';';
    }
    return out;
  }

  function wrap(wrappers, text) {
    for (let i = wrappers.length - 1; i >= 0; i--) text = wrappers[i] + '{' + text + '}';
    return text;
  }

  function walkRules(rules, wrappers, out, P, opts, depth) {
    if (!rules || depth > 12) return;
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      try {
        if (rule instanceof CSSStyleRule) {
          const sel = rule.selectorText;
          if (!(opts.skipSelector && opts.skipSelector(sel))) {
            const decl = compileDeclarations(rule.style, P, opts.skipProp);
            if (decl) out.push(wrap(wrappers, sel + '{' + decl + '}'));
          }
          if (rule.cssRules && rule.cssRules.length) {
            walkRules(rule.cssRules, wrappers.concat(sel), out, P, opts, depth + 1);
          }
        } else if (rule instanceof CSSMediaRule) {
          walkRules(rule.cssRules, wrappers.concat('@media ' + rule.conditionText), out, P, opts, depth + 1);
        } else if (rule instanceof CSSSupportsRule) {
          walkRules(rule.cssRules, wrappers.concat('@supports ' + rule.conditionText), out, P, opts, depth + 1);
        } else if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) {
          walkRules(rule.cssRules, wrappers.concat('@container ' + rule.conditionText), out, P, opts, depth + 1);
        } else if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule) {
          walkRules(rule.cssRules, wrappers, out, P, opts, depth + 1); // flatten layers
        } else if (rule instanceof CSSImportRule) {
          const sheet = rule.styleSheet;
          if (sheet) {
            const media = rule.media && rule.media.mediaText ? ['@media ' + rule.media.mediaText] : [];
            walkRules(sheet.cssRules, wrappers.concat(media), out, P, opts, depth + 1);
          }
        }
      } catch (_) {
        /* cross-origin @import or detached rule: skip */
      }
    }
  }

  function readRules(sheet) {
    try {
      return sheet.cssRules;
    } catch (_) {
      return null; // cross-origin
    }
  }

  /* ------------------------------------------------------------------ */
  /* Inline styles                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Frameworks often paint surfaces through element.style (sticky headers,
   * animated bars). Those declarations never appear in a stylesheet, so they
   * are matched by their literal text instead: for every light inline colour
   * seen on the page, a rule like
   *   [style*="background-color: rgb(255, 255, 255)"] { background-color: … !important }
   * is emitted. The DOM is never written to, and saturated (brand / chart /
   * status) colours are left alone by the same mapping rules as above.
   *
   * Translucent colours that animate frame by frame (`rgba(255, 255, 255, 0.73)`,
   * then `0.81`, …) additionally get one *prefix* rule that covers every alpha,
   * so scrolling never produces a frame the engine has not seen yet.
   */
  const INLINE_LONGHAND = {
    'background': 'background-color',
    'background-color': 'background-color',
    'color': 'color',
    'fill': 'fill',
    'stroke': 'stroke',
    'caret-color': 'caret-color',
    'border': 'border-color',
    'border-color': 'border-color',
    'border-top': 'border-top-color',
    'border-right': 'border-right-color',
    'border-bottom': 'border-bottom-color',
    'border-left': 'border-left-color',
    'border-top-color': 'border-top-color',
    'border-right-color': 'border-right-color',
    'border-bottom-color': 'border-bottom-color',
    'border-left-color': 'border-left-color',
    'outline': 'outline-color',
    'outline-color': 'outline-color',
    'box-shadow': 'box-shadow'
  };
  const INLINE_MAX = 600;
  const HAS_COLOR = /rgb|#[0-9a-f]{3}|\b(?:white|black|gr[ae]y|silver)\b/i;
  const TRANSLUCENT_RE = /^(rgba?\(\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*[,/])\s*[\d.]+%?\s*\)$/i;

  /** Split a style attribute into raw declarations, respecting parentheses. */
  function splitDeclarations(text) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ';' && depth === 0) {
        const part = text.slice(start, i).trim();
        if (part) out.push(part);
        start = i + 1;
      }
    }
    const tail = text.slice(start).trim();
    if (tail) out.push(tail);
    return out;
  }

  function cssEscapeString(str) {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
  }

  /** Anchor on the declaration start so "color: x" never matches "background-color: x". */
  function styleSelector(key) {
    const k = cssEscapeString(key);
    return `[style^="${k}"],[style*="; ${k}"],[style*=";${k}"]`;
  }

  function mapSingleColor(kind, c, P) {
    return kind === 'bg' ? mapBackground(c, P) : kind === 'text' ? mapText(c, P) : mapBorder(c, P);
  }

  /**
   * @returns {{exact: string|null, prefixKey: string|null, prefix: string|null}|null}
   */
  function compileInlineDeclaration(raw, P) {
    if (/!important/i.test(raw)) return null; // cannot be beaten from a stylesheet
    const colon = raw.indexOf(':');
    if (colon < 1) return null;
    const name = raw.slice(0, colon).trim().toLowerCase();
    const longhand = INLINE_LONGHAND[name];
    if (!longhand) return null;
    const value = raw.slice(colon + 1).trim();
    if (!value || value.indexOf('var(') !== -1) return null;
    const kind = PROP_KIND[longhand] || (longhand === 'border-color' ? 'border' : null);
    if (!kind) return null;

    let mapped;
    if (name === longhand || kind === 'shadow') {
      mapped = mapValue(kind, value, P);
    } else {
      // Shorthand (background / border / outline): keep only the colour part.
      let first = null;
      Color.replaceTokens(value, (c) => {
        if (first) return null;
        const m = mapSingleColor(kind, c, P);
        if (m) first = m;
        return m;
      });
      mapped = first;
    }
    const exact = mapped && mapped !== value ? `${styleSelector(raw)}{${longhand}:${mapped} !important;}` : null;

    // Prefix rule for animated alpha values.
    let prefixKey = null;
    let prefix = null;
    const tm = kind !== 'shadow' ? TRANSLUCENT_RE.exec(value) : null;
    if (tm) {
      const c = Color.parse(value);
      if (c && c.a < 0.999) {
        const representative = mapSingleColor(kind, Object.assign({}, c, { a: 0.9 }), P);
        if (representative) {
          prefixKey = raw.slice(0, raw.indexOf(value)) + tm[1];
          prefix = `${styleSelector(prefixKey)}{${longhand}:${representative} !important;}`;
        }
      }
    }
    if (!exact && !prefix) return null;
    return { exact, prefixKey, prefix };
  }

  /**
   * SVG glyph icons are often coloured through presentation attributes
   * (`<svg fill="#333">`), which no stylesheet ever mentions. A plain CSS rule
   * outranks a presentation attribute, so `[fill="#333"] { fill: … }` is
   * enough. Only near-neutral greys are remapped: colourful artwork
   * (illustrations, brand marks, status glyphs) is deliberately left alone.
   */
  const ATTR_PROPS = ['fill', 'stroke'];
  const ATTR_MAX = 200;

  function compileColorAttribute(name, value, P) {
    const c = Color.parse(value);
    if (!c || c.a < 0.02) return null;
    if (chromaOf(c) > 0.15) return null; // colourful: keep as designed
    const mapped = mapText(c, P);
    if (!mapped) return null;
    return `[${name}="${cssEscapeString(value)}"]{${name}:${mapped};}`;
  }

  /* ------------------------------------------------------------------ */
  /* Engine                                                              */
  /* ------------------------------------------------------------------ */

  function sameList(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  class StoreDarkRemapper {
    /**
     * @param {object} options
     * @param {object} [options.palette]
     * @param {(selector:string)=>boolean} [options.skipSelector]
     * @param {(prop:string)=>boolean} [options.skipProp]
     * @param {()=>void} [options.onMutation]  called after each DOM-triggered flush
     */
    constructor(options = {}) {
      this.P = Object.assign({}, DEFAULT_PALETTE, options.palette || {});
      this.opts = { skipSelector: options.skipSelector, skipProp: options.skipProp };
      this.onMutation = options.onMutation || null;
      this.running = false;
      this.flushing = false;

      // One compiled (constructed) sheet per source sheet, so that a change in
      // one small sheet (styled-components) never rebuilds the big ones.
      this.cache = new WeakMap();   // source CSSStyleSheet -> { count, text, sheet }
      this.owned = new WeakSet();   // constructed sheets we created
      this.targets = new Map();     // Document | ShadowRoot -> { styleEl, styleText }
      this.useConstructed = typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype;

      // Rules derived from inline styles and SVG attributes: one shared sheet,
      // appended to with insertRule (cheap, no rebuild).
      this.dynSheet = null;
      this.dynRules = [];           // rule texts in insertion order
      this.dynInserted = 0;
      this.inlineRules = new Map(); // raw declaration -> true (handled)
      this.inlinePrefixes = new Set();
      this.attrRules = new Map();   // "fill=#333" -> true

      this.observers = [];
      this.shadowHosts = new WeakSet();
      this.pendingAttr = new Set();
      this.pendingAdded = new Set();
      this.timer = 0;
      this.rafId = 0;
      this.stats = { flushes: 0, compiles: 0, ms: 0 };
      this._onLoad = (e) => {
        const t = e.target;
        if (t && t.tagName === 'LINK') this._flush(false);
      };
      // Fired by src/page-hook.js (page world) right after the page edits the
      // CSSOM — insertRule, replaceSync, adoptedStyleSheets — so the recompile
      // lands in the same task, before the next paint.
      this._onCssom = () => this._flush(false);
    }

    start() {
      if (this.running) return;
      this.running = true;
      this._ensureTarget(document);
      this._observe(document);
      // Stylesheet <link> loads do not mutate the DOM; recompile the moment one arrives.
      document.addEventListener('load', this._onLoad, true);
      document.addEventListener('storedark:cssom', this._onCssom);
      this._scanInlineSubtree(document);
      this._discoverShadowRoots(document);
      this._flush(true);
      // Safety net for changes nothing notifies us about (CSSOM edits without DOM churn).
      this.timer = setInterval(() => this._tick(), 500);
    }

    stop() {
      if (!this.running) return;
      this.running = false;
      clearInterval(this.timer);
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      document.removeEventListener('load', this._onLoad, true);
      document.removeEventListener('storedark:cssom', this._onCssom);
      for (const o of this.observers) o.disconnect();
      this.observers = [];
      for (const [node, t] of this.targets) this._detach(node, t);
      this.targets.clear();
      this.cache = new WeakMap();
      this.owned = new WeakSet();
      this.dynSheet = null;
      this.dynRules = [];
      this.dynInserted = 0;
      this.inlineRules.clear();
      this.inlinePrefixes.clear();
      this.attrRules.clear();
      this.pendingAttr.clear();
      this.pendingAdded.clear();
      this.shadowHosts = new WeakSet();
    }

    /** Re-scan everything. `force` recompiles every sheet. */
    refresh(force) {
      if (!this.running) return;
      this._discoverShadowRoots(document);
      this._flush(!!force);
    }

    /* ---- scheduling ---- */

    /**
     * Runs synchronously inside MutationObserver callbacks, i.e. in the same
     * task as the page's own DOM/CSSOM changes and therefore *before* the
     * browser paints the next frame. That is what prevents light flashes.
     */
    _flush(force) {
      if (!this.running || this.flushing) return;
      this.flushing = true;
      const t0 = performance.now();
      try {
        this._processInline();
        for (const [node, t] of this.targets) this._compileTarget(node, t, force);
      } finally {
        this.flushing = false;
        this.stats.flushes++;
        this.stats.ms += performance.now() - t0;
      }
    }

    /** One more cheap check right before the next frame is painted. */
    _flushBeforePaint() {
      if (this.rafId) return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        this._flush(false);
      });
    }

    _tick() {
      if (!this.running || document.visibilityState === 'hidden') return;
      this._discoverShadowRoots(document);
      this._flush(false);
    }

    _observe(node) {
      const mo = new MutationObserver((records) => {
        if (!this.running) return;
        for (const r of records) {
          if (r.type === 'attributes') {
            this.pendingAttr.add(r.target);
            continue;
          }
          for (const n of r.addedNodes) if (n.nodeType === 1) this.pendingAdded.add(n);
        }
        this._flush(false);
        this._flushBeforePaint();
        if (this.onMutation) this.onMutation();
      });
      mo.observe(node === document ? document.documentElement : node, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'fill', 'stroke']
      });
      this.observers.push(mo);
    }

    /* ---- targets & sheets ---- */

    _ensureTarget(node) {
      if (this.targets.has(node)) return this.targets.get(node);
      const t = { styleEl: null, styleText: '' };
      this.targets.set(node, t);
      return t;
    }

    _sheetsOf(node) {
      const list = [];
      const own = node.styleSheets;
      for (let i = 0; i < own.length; i++) list.push(own[i]);
      const adopted = node.adoptedStyleSheets || [];
      for (const s of adopted) if (!this.owned.has(s)) list.push(s);
      return list;
    }

    _entryFor(sheet, rules, force) {
      let entry = this.cache.get(sheet);
      if (!entry) {
        entry = { count: -1, text: '', sheet: null };
        this.cache.set(sheet, entry);
      }
      if (force || entry.count !== rules.length) {
        this.stats.compiles++;
        const out = [];
        walkRules(rules, [], out, this.P, this.opts, 0);
        const text = out.join('\n');
        entry.count = rules.length;
        if (text !== entry.text) {
          entry.text = text;
          if (this.useConstructed) {
            try {
              if (!entry.sheet) {
                entry.sheet = new CSSStyleSheet();
                this.owned.add(entry.sheet);
              }
              entry.sheet.replaceSync(text);
            } catch (_) {
              this.useConstructed = false; // fall back to <style> elements
            }
          }
        }
      }
      return entry;
    }

    _compileTarget(node, t, force) {
      const desired = [];
      const entries = [];
      for (const sheet of this._sheetsOf(node)) {
        const rules = readRules(sheet);
        if (!rules) continue;
        const entry = this._entryFor(sheet, rules, force);
        entries.push(entry);
        if (entry.text && entry.sheet) desired.push(entry.sheet);
      }

      if (this.useConstructed) {
        const dyn = this._dynSheet();
        if (dyn) desired.push(dyn);
        const current = node.adoptedStyleSheets || [];
        const others = [];
        for (const s of current) if (!this.owned.has(s)) others.push(s);
        const next = others.concat(desired);
        if (!sameList(current, next)) {
          try {
            node.adoptedStyleSheets = next;
            return;
          } catch (_) {
            this.useConstructed = false;
          }
        } else {
          return;
        }
      }

      // Fallback: one <style> element per root.
      const text = entries.map((e) => e.text).filter(Boolean).concat(this.dynRules).join('\n');
      if (text === t.styleText && t.styleEl && t.styleEl.isConnected) return;
      t.styleText = text;
      if (!t.styleEl) {
        t.styleEl = document.createElement('style');
        t.styleEl.setAttribute('data-store-dark-engine', '');
      }
      t.styleEl.textContent = text;
      const container = node === document ? document.documentElement : node;
      if (t.styleEl.parentNode !== container || container.lastElementChild !== t.styleEl) {
        container.appendChild(t.styleEl);
      }
    }

    _dynSheet() {
      if (!this.dynSheet) {
        try {
          this.dynSheet = new CSSStyleSheet();
          this.owned.add(this.dynSheet);
        } catch (_) {
          this.useConstructed = false;
          return null;
        }
      }
      while (this.dynInserted < this.dynRules.length) {
        const rule = this.dynRules[this.dynInserted++];
        try {
          this.dynSheet.insertRule(rule, this.dynSheet.cssRules.length);
        } catch (_) {
          /* malformed selector text from an exotic attribute: skip */
        }
      }
      return this.dynSheet;
    }

    _detach(node, t) {
      try {
        const current = node.adoptedStyleSheets || [];
        const kept = current.filter((s) => !this.owned.has(s));
        if (kept.length !== current.length) node.adoptedStyleSheets = kept;
      } catch (_) {
        /* ignore */
      }
      if (t.styleEl && t.styleEl.parentNode) t.styleEl.parentNode.removeChild(t.styleEl);
    }

    /* ---- inline styles & attributes ---- */

    _noteInlineElement(el) {
      if (!el.getAttribute) return;
      for (const name of ATTR_PROPS) {
        const v = el.getAttribute(name);
        if (!v) continue;
        const key = name + '=' + v;
        if (this.attrRules.has(key)) continue;
        if (this.attrRules.size >= ATTR_MAX) break;
        this.attrRules.set(key, true);
        const rule = compileColorAttribute(name, v.trim(), this.P);
        if (rule) this.dynRules.push(rule);
      }
      const attr = el.getAttribute('style');
      if (!attr || !HAS_COLOR.test(attr)) return;
      for (const raw of splitDeclarations(attr)) {
        if (this.inlineRules.has(raw)) continue;
        if (this.inlineRules.size >= INLINE_MAX) return;
        this.inlineRules.set(raw, true);
        const compiled = compileInlineDeclaration(raw, this.P);
        if (!compiled) continue;
        if (compiled.prefix && !this.inlinePrefixes.has(compiled.prefixKey)) {
          this.inlinePrefixes.add(compiled.prefixKey);
          this.dynRules.push(compiled.prefix);
        }
        if (compiled.exact) this.dynRules.push(compiled.exact);
      }
    }

    _scanInlineSubtree(scope) {
      if (scope.nodeType === 1) this._noteInlineElement(scope);
      const list = scope.querySelectorAll ? scope.querySelectorAll('[style],[fill],[stroke]') : [];
      for (let i = 0; i < list.length; i++) this._noteInlineElement(list[i]);
    }

    _processInline() {
      for (const el of this.pendingAttr) if (el.isConnected) this._noteInlineElement(el);
      this.pendingAttr.clear();
      for (const el of this.pendingAdded) {
        if (!el.isConnected) continue;
        this._scanInlineSubtree(el);
        // Only the added subtree: roots attached later are found by the 500 ms tick.
        this._discoverShadowRoots(el);
      }
      this.pendingAdded.clear();
    }

    /* ---- shadow DOM ---- */

    _discoverShadowRoots(scope) {
      if (scope.nodeType === 1 && scope.shadowRoot) this._adoptShadowRoot(scope);
      const all = scope.querySelectorAll ? scope.querySelectorAll('*') : [];
      for (let i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) this._adoptShadowRoot(all[i]);
      }
    }

    _adoptShadowRoot(host) {
      if (this.shadowHosts.has(host)) return;
      this.shadowHosts.add(host);
      const sr = host.shadowRoot;
      this._ensureTarget(sr);
      this._observe(sr);
      this._scanInlineSubtree(sr);
      this._discoverShadowRoots(sr);
    }
  }

  root.StoreDarkRemapper = StoreDarkRemapper;
  root.StoreDarkRemapper.mapValue = mapValue; // exposed for tests
  root.StoreDarkRemapper.compileInlineDeclaration = compileInlineDeclaration;
  root.StoreDarkRemapper.compileColorAttribute = compileColorAttribute;
})(typeof self !== 'undefined' ? self : this);
