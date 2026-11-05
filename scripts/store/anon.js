/*
 * In-page anonymiser for store screenshots. Evaluated as `(fn)(config)` by shot.mjs.
 * Replaces real app / account names, package & bundle IDs, e-mails, avatar and
 * app-icon images, and standalone numbers (stats) with fictional ones, so a
 * capture of the real console shows the real UI with made-up data.
 *
 * config: { names: { "Real name": "Fictional name", ... }, scrambleNumbers: true, checkOnly: false }
 * checkOnly: change nothing, only report real names still visible (for a second capture of an already anonymised page).
 */
(function anonymize(cfg) {
  cfg = cfg || {};
  const report = { text: 0, attrs: 0, images: 0, numbers: 0, ids: 0, emails: 0, leftovers: [] };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const names = Object.entries(cfg.names || {}).filter(([r]) => r.trim()).sort((a, b) => b[0].length - a[0].length);
  const nameRe = names.length ? new RegExp(names.map(([r]) => esc(r)).join('|'), 'gi') : null;
  const lookup = new Map(names.map(([r, f]) => [r.toLowerCase(), f]));
  const fakeNames = [...new Set(names.map(([, f]) => f))];

  const idRe = /\b(?:com|org|net|io|app|dev)\.[a-z0-9_]+(?:\.[a-z0-9_]+)+\b/gi;
  const emailRe = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
  const slugs = ['weatherly', 'pocketledger', 'dailyhabits', 'recipebox', 'nightreader', 'quicknotes', 'mealplan', 'focustimer'];
  const idMap = new Map();
  const fakeId = (m) => { if (!idMap.has(m)) idMap.set(m, 'com.example.' + slugs[idMap.size % slugs.length]); return idMap.get(m); };

  function fix(s) {
    let v = s;
    if (nameRe) v = v.replace(nameRe, (m) => lookup.get(m.toLowerCase()) ?? m);
    v = v.replace(idRe, (m) => { report.ids++; return fakeId(m); });
    v = v.replace(emailRe, () => { report.emails++; return 'developer@example.com'; });
    return v;
  }

  /* ---- numbers ---- */
  const numRe = /^\s*[+\-−]?[$€£¥]?\s?\d[\d,.  \s]*(?:[%KMk]|\+)?\s*$/;
  const yearRe = /^\s*(?:19|20)\d\d\s*$/;
  const ratingRe = /^\s*[0-5]\.(\d{1,2})\s*$/;
  const versionRe = /^\s*\d+(?:\.\d+){2,}\s*$/;
  const percentRe = /^(\s*[+\-−]?)(\d[\d,.]*)(\s*%\s*)$/;
  function scramble(s) {
    if (versionRe.test(s)) return s;
    const rating = s.match(ratingRe);
    if (rating) return s.replace(/[0-5]\.\d+/, (3.6 + Math.random() * 1.3).toFixed(rating[1].length));
    const pct = s.match(percentRe);
    if (pct) {
      const decimals = (pct[2].split('.')[1] || '').length;
      const value = parseFloat(pct[2].replace(/,/g, ''));
      const fake = value < 1 ? 0.1 + Math.random() * 0.8 : value < 10 ? 1 + Math.random() * 8.9 : 5 + Math.random() * 90;
      return pct[1] + fake.toFixed(decimals) + pct[3];
    }
    let first = true;
    return s.replace(/\d/g, () => {
      let n = Math.floor(Math.random() * 10);
      if (first) { first = false; if (n === 0) n = 1 + Math.floor(Math.random() * 9); }
      return String(n);
    });
  }
  const skipNum = (el) => !!el.closest('time, [class*="date" i], [class*="version" i], [class*="footer" i], .store-dark-credit');

  /* ---- images ---- */
  const iconHosts = /googleusercontent\.com|ggpht\.com|lh3\.google\.com|mzstatic\.com/i;
  const palette = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316'];
  let ci = 0;
  const colorFor = () => palette[ci++ % palette.length];
  const svgUrl = (svg) => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  const iconSvg = (L, c) => svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${c}"/>` +
    `<text x="32" y="42" text-anchor="middle" font-family="Roboto,Helvetica,Arial,sans-serif" font-size="30" font-weight="700" fill="#fff">${L}</text></svg>`);
  const avatarSvg = svgUrl(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#5b6475"/>' +
    '<circle cx="32" cy="25" r="11" fill="#e6e9f0"/><path d="M12 56a20 20 0 0 1 40 0z" fill="#e6e9f0"/></svg>');
  const center = (r) => [r.left + r.width / 2, r.top + r.height / 2];
  function letterFor(el) {
    const [cx, cy] = center(el.getBoundingClientRect());
    let e = el;
    for (let i = 0; i < 12 && e; i++) {
      const t = e.textContent || '';
      const hits = fakeNames.filter((f) => t.includes(f));
      if (hits.length === 1) return hits[0][0].toUpperCase();
      if (hits.length > 1) {
        // several names in this subtree (a list, a switcher): take the one drawn nearest the image
        let best = null, bestD = Infinity;
        for (const leaf of e.querySelectorAll('*')) {
          if (leaf.children.length) continue;
          const txt = leaf.textContent || '';
          const hit = hits.find((f) => txt.includes(f));
          if (!hit) continue;
          const r = leaf.getBoundingClientRect();
          if (!r.width) continue;
          const [x, y] = center(r);
          const d = Math.hypot(x - cx, y - cy);
          if (d < bestD) { bestD = d; best = hit; }
        }
        return (best || hits[0])[0].toUpperCase();
      }
      e = e.parentElement || (e.getRootNode && e.getRootNode().host);
    }
    return 'ABCDEFGH'[ci % 8];
  }
  const imageQueue = [];
  function handleImg(img) {
    const src = img.currentSrc || img.src || '';
    if (!iconHosts.test(src)) return;
    const isAvatar = /=s\d+-c|\/a\/|\/a-\//.test(src) ||
      !!img.closest('header, [role="banner"], [class*="avatar" i], [class*="profile" i]');
    img.removeAttribute('srcset');
    img.src = isAvatar ? avatarSvg : iconSvg(letterFor(img), colorFor());
    report.images++;
  }

  /* ---- walk (incl. open shadow roots) ---- */
  function walk(root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 1) {
        if (n.shadowRoot) walk(n.shadowRoot);
        const tag = n.tagName;
        if (/^Dark Mode By:/.test(n.textContent || '')) continue; // the extension's own credit link
        for (const a of ['alt', 'title', 'aria-label', 'placeholder', 'data-tooltip']) {
          const v = n.getAttribute(a);
          if (v) { const nv = fix(v); if (nv !== v) { n.setAttribute(a, nv); report.attrs++; } }
        }
        if ((tag === 'INPUT' || tag === 'TEXTAREA') && n.value) {
          const nv = fix(n.value);
          if (nv !== n.value) { n.value = nv; report.attrs++; }
        }
        if (tag === 'IMG' || (n.style && n.style.backgroundImage && iconHosts.test(n.style.backgroundImage))) imageQueue.push(n);
        continue;
      }
      const p = n.parentElement;
      if (!p) continue;
      const tag = p.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
      const orig = n.nodeValue;
      if (/^\s*Dark Mode By:/.test(orig)) continue;
      let v = fix(orig);
      if (cfg.scrambleNumbers !== false && numRe.test(v) && !yearRe.test(v) && !skipNum(p)) { v = scramble(v); report.numbers++; }
      if (v !== orig) { n.nodeValue = v; report.text++; }
    }
  }
  // Visible-ish text only: script/style/template contents are not rendered, and the
  // extension's own credit link is allowed to keep its author name.
  function textOf(root) {
    let s = '';
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 1) { if (n.shadowRoot) s += ' ' + textOf(n.shadowRoot); continue; }
      const t = n.parentElement && n.parentElement.tagName;
      if (t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT' || t === 'TEMPLATE') continue;
      if (/^\s*Dark Mode By:/.test(n.nodeValue)) continue;
      s += ' ' + n.nodeValue;
    }
    return s;
  }

  /* ---- Play Console scorecards: healthy, growing numbers (cfg.upbeat !== false) ---- */
  function upbeat() {
    for (const cv of document.querySelectorAll('.change-value')) {
      if (cv.classList.contains('neutral-change-value') || cv.classList.contains('locked-change-value')) continue;
      const textEl = [...cv.querySelectorAll('span')].find((e) => !e.children.length && /\d/.test(e.textContent));
      if (!textEl) continue;
      const m = textEl.textContent.trim().match(/^([-−+]?)\s*([\d.,]+)\s*(%|pp)?$/);
      if (!m) continue;
      const unit = m[3] || '';
      const icon = cv.querySelector('.change-value-icon');
      const lowerIsBetter = !!cv.closest('[downwards-good]');
      let value;
      if (unit === 'pp') value = (0.01 + Math.random() * 0.05).toFixed(3);
      else if (unit === '%') value = String(Math.round(lowerIsBetter ? 2 + Math.random() * 12 : 8 + Math.random() * 60));
      else value = m[2].includes('.') ? (0.05 + Math.random() * 0.4).toFixed(2) : String(Math.round(8 + Math.random() * 60));
      // the metric improves: up and green, or (for "lower is better" metrics) down and green
      cv.classList.toggle('negative-change-value', lowerIsBetter);
      cv.classList.toggle('positive-change-value', !lowerIsBetter);
      textEl.textContent = (lowerIsBetter ? '-' : '+') + value + unit;
      // the icon is a left-pointing glyph rotated -90° by the page's CSS: "left" becomes
      // "down", so a right-pointing glyph is what points up
      const glyph = icon && icon.querySelector('i');
      if (glyph) glyph.textContent = lowerIsBetter ? 'arrow_left_alt' : 'arrow_right_alt';
      report.deltas = (report.deltas || 0) + 1;
    }
    for (const v of document.querySelectorAll('.value-and-description .value')) {
      if (v.children.length) continue;
      const t = v.textContent.trim();
      if (/^\d{1,2}$/.test(t)) v.textContent = String(Math.round(300 + Math.random() * 680));
      else if (/^\d{3}$/.test(t)) v.textContent = (1.1 + Math.random() * 8.8).toFixed(2) + 'K';
    }
  }

  if (!cfg.checkOnly) {
    walk(document);
    document.title = fix(document.title);
    if (cfg.upbeat !== false) upbeat();
    for (const n of imageQueue) {
      if (n.tagName === 'IMG') handleImg(n);
      else { n.style.backgroundImage = `url("${iconSvg(letterFor(n), colorFor())}")`; report.images++; }
    }
  }
  const all = textOf(document.body).toLowerCase();
  for (const [r, f] of names) if (r !== f && all.includes(r.toLowerCase())) report.leftovers.push(r);
  return report;
})
