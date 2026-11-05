/**
 * Credit link — "Dark Mode By: Salar Dev" — placed inside each site's own
 * footer, next to the site's existing footer links, so it inherits their
 * typography and colours and never overlaps content. It exists only while
 * the theme is active and is removed when the theme is switched off.
 *
 * Site adapters describe where to mount it (`badge.slots`); paths may cross
 * open shadow roots (App Store Connect's footer is a web component).
 */
(function (root) {
  'use strict';

  const LABEL = 'Dark Mode By: Salar Dev';
  const HREF = 'https://github.com/salar-dev';
  const TITLE = 'Dark Mode for Play Console & App Store Connect — by Salar Dev (GitHub)';
  const ATTR = 'data-store-dark-badge';

  const mounted = new Set();

  function resolveAll(path) {
    let scopes = [document];
    for (let i = 0; i < path.length; i++) {
      const next = [];
      const last = i === path.length - 1;
      for (const scope of scopes) {
        if (!scope || typeof scope.querySelectorAll !== 'function') continue;
        const found = scope.querySelectorAll(path[i]);
        for (const el of found) next.push(last ? el : el.shadowRoot || el);
      }
      scopes = next;
      if (!scopes.length) break;
    }
    return scopes;
  }

  /**
   * Angular (Play Console) scopes its CSS with generated `_ngcontent-*`
   * attributes; copying them from a sibling link lets the footer's own link
   * styles apply to ours, so it looks exactly like its neighbours.
   */
  function copyScopeAttributes(from, to) {
    if (!from) return;
    for (const attr of from.attributes) {
      if (/^_ng(content|host)-/.test(attr.name)) to.setAttribute(attr.name, attr.value);
    }
  }

  function build(slot, container) {
    const a = document.createElement('a');
    a.setAttribute(ATTR, '');
    a.href = HREF;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = TITLE;
    a.textContent = LABEL;
    if (slot.linkClass) a.className = slot.linkClass;
    if (slot.linkAttrs) for (const k of Object.keys(slot.linkAttrs)) a.setAttribute(k, slot.linkAttrs[k]);
    if (slot.mimic) copyScopeAttributes(container.querySelector(slot.mimic), a);
    if (!slot.wrap) return a;
    const w = document.createElement(slot.wrap);
    w.setAttribute(ATTR + '-wrap', '');
    if (slot.wrapAttrs) for (const k of Object.keys(slot.wrapAttrs)) w.setAttribute(k, slot.wrapAttrs[k]);
    w.appendChild(a);
    return w;
  }

  /** Mount wherever a slot container exists and has no badge yet. Cheap; safe to call often. */
  function ensure(config) {
    if (!config || !config.slots) return;
    for (const slot of config.slots) {
      const containers = resolveAll(slot.path);
      for (const container of containers) {
        if (!container || container.nodeType !== 1) continue;
        if (container.querySelector(`:scope > [${ATTR}], :scope > [${ATTR}-wrap]`)) continue;
        const node = build(slot, container);
        container.appendChild(node);
        mounted.add(node);
      }
    }
    // Forget nodes the site removed itself (re-rendered footers).
    for (const node of mounted) if (!node.isConnected) mounted.delete(node);
  }

  function remove() {
    for (const node of mounted) {
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    mounted.clear();
    // Belt and braces: anything left in the light DOM.
    for (const el of document.querySelectorAll(`[${ATTR}], [${ATTR}-wrap]`)) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  }

  root.StoreDarkBadge = Object.freeze({ ensure, remove, LABEL, HREF, ATTR });
})(typeof self !== 'undefined' ? self : this);
