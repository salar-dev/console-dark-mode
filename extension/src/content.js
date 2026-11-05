/**
 * Content script — runs at document_start on play.google.com/console and
 * appstoreconnect.apple.com.
 *
 * Keeps the page's dark state in sync with the user's settings:
 *   1. `data-store-dark="<site>"` on <html> scopes the static CSS.
 *   2. The site adapter's root classes switch on the site's own hidden dark
 *      theme (Play Console: `acx-dark-theme`, ASC: `dark`).
 *   3. The dynamic engine recolours whatever the site's stylesheets still
 *      paint light, including hashed class names and open shadow roots.
 *
 * Turning the theme off reverses all three — no reload needed.
 */
(() => {
  'use strict';

  const { ROOT_ATTR, normalize, siteForLocation } = self.StoreDark;
  const adapter = self.StoreDarkSite;
  const badge = self.StoreDarkBadge;
  const svgInline = self.StoreDarkSvg;
  const site = siteForLocation(location);
  if (!site || !adapter || adapter.key !== site) return;

  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  let settings = normalize(null);
  let active = false;

  /* ------------------------------------------------------------------ */
  /* Class swaps inside (shadow) DOM                                      */
  /* ------------------------------------------------------------------ */

  const swapped = new WeakSet(); // elements whose class we changed

  function resolvePath(path) {
    let scope = document;
    let el = null;
    for (const step of path) {
      if (!scope || typeof scope.querySelector !== 'function') return null;
      el = scope.querySelector(step);
      if (!el) return null;
      scope = el.shadowRoot || el;
    }
    return el;
  }

  function applySwaps(on) {
    for (const swap of adapter.classSwaps) {
      const el = resolvePath(swap.path);
      if (!el) continue;
      if (on) {
        if (el.classList.contains(swap.from) || !el.classList.contains(swap.to)) {
          el.classList.remove(swap.from);
          el.classList.add(swap.to);
          swapped.add(el);
        }
      } else if (swapped.has(el)) {
        el.classList.remove(swap.to);
        el.classList.add(swap.from);
        swapped.delete(el);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Engine                                                               */
  /* ------------------------------------------------------------------ */

  const engine = new self.StoreDarkRemapper({
    palette: adapter.palette,
    skipSelector: adapter.skipSelector,
    onMutation: () => {
      if (active) {
        applySwaps(true);
        assertRoot();
        badge.ensure(adapter.badge);
        svgInline.ensure(adapter);
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /* Root attribute / classes                                             */
  /* ------------------------------------------------------------------ */

  function assertRoot() {
    if (root.getAttribute(ROOT_ATTR) !== site) root.setAttribute(ROOT_ATTR, site);
    for (const cls of adapter.rootClasses) if (!root.classList.contains(cls)) root.classList.add(cls);
  }

  function clearRoot() {
    root.removeAttribute(ROOT_ATTR);
    for (const cls of adapter.rootClasses) root.classList.remove(cls);
  }

  // Frameworks sometimes rewrite <html class="…"> wholesale; put ours back.
  const guard = new MutationObserver(() => {
    if (active) assertRoot();
  });

  function enable() {
    if (active) return;
    active = true;
    assertRoot();
    guard.observe(root, { attributes: true, attributeFilter: ['class', ROOT_ATTR] });
    engine.start();
    applySwaps(true);
    badge.ensure(adapter.badge);
    svgInline.ensure(adapter);
  }

  function disable() {
    if (!active) return;
    active = false;
    guard.disconnect();
    engine.stop();
    applySwaps(false);
    badge.remove();
    svgInline.remove();
    clearRoot();
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                             */
  /* ------------------------------------------------------------------ */

  const shouldBeDark = () =>
    settings.enabled && settings.sites[site] && (!settings.followSystem || prefersDark.matches);

  const apply = () => (shouldBeDark() ? enable() : disable());

  // Apply the defaults (dark on) synchronously at document_start so the very
  // first paint is already dark; the stored settings arrive a few ms later and
  // may switch it off again.
  apply();
  chrome.storage.sync.get(null, (raw) => {
    if (!chrome.runtime.lastError) settings = normalize(raw);
    apply();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const patch = {};
    for (const key of Object.keys(changes)) patch[key] = changes[key].newValue;
    settings = normalize({ ...settings, ...patch });
    apply();
  });

  prefersDark.addEventListener('change', apply);
})();
