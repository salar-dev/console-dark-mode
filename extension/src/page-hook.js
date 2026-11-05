/**
 * Page-world hook (runs in the page's own JavaScript world, see manifest
 * `world: "MAIN"`). Content scripts live in an isolated world and cannot see
 * when the page edits the CSSOM directly — styled-components, for example,
 * inserts rules with `insertRule` and never touches the DOM. This tiny shim
 * wraps those entry points and fires one `storedark:cssom` event per task so
 * the engine can recompile *before* the browser paints the next frame.
 *
 * It reads nothing, stores nothing and exposes nothing on `window`.
 */
(() => {
  'use strict';
  if (window.__storeDarkHooked) return;
  try {
    Object.defineProperty(window, '__storeDarkHooked', { value: true, configurable: true });
  } catch (_) {
    /* ignore */
  }

  let pending = false;
  const notify = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      try {
        document.dispatchEvent(new Event('storedark:cssom'));
      } catch (_) {
        /* ignore */
      }
    });
  };

  const wrapMethod = (proto, name) => {
    const original = proto && proto[name];
    if (typeof original !== 'function') return;
    try {
      Object.defineProperty(proto, name, {
        configurable: true,
        writable: true,
        value: function () {
          const result = original.apply(this, arguments);
          if (result && typeof result.then === 'function') {
            result.then(notify, () => {});
          } else {
            notify();
          }
          return result;
        }
      });
    } catch (_) {
      /* frozen prototype: skip */
    }
  };

  const wrapSetter = (proto, name) => {
    const desc = proto && Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.set !== 'function') return;
    try {
      Object.defineProperty(proto, name, {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set: function (v) {
          desc.set.call(this, v);
          notify();
        }
      });
    } catch (_) {
      /* ignore */
    }
  };

  if (typeof CSSStyleSheet !== 'undefined') {
    for (const m of ['insertRule', 'deleteRule', 'replaceSync', 'replace', 'addRule', 'removeRule']) {
      wrapMethod(CSSStyleSheet.prototype, m);
    }
  }
  if (typeof CSSGroupingRule !== 'undefined') {
    wrapMethod(CSSGroupingRule.prototype, 'insertRule');
    wrapMethod(CSSGroupingRule.prototype, 'deleteRule');
  }
  wrapSetter(Document.prototype, 'adoptedStyleSheets');
  if (typeof ShadowRoot !== 'undefined') wrapSetter(ShadowRoot.prototype, 'adoptedStyleSheets');
})();
