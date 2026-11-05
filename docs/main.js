/* Console Dark Mode landing page: store link wiring, lightbox, footer year. */
(() => {
  'use strict';

  // One place to set the Chrome Web Store URL: the data-store-url attribute on <html>.
  const storeUrl = (document.documentElement.dataset.storeUrl || '').trim();
  if (storeUrl) {
    document.querySelectorAll('.js-store').forEach((a) => {
      a.href = storeUrl;
      a.target = '_blank';
      a.rel = 'noopener';
    });
    const copy = document.querySelector('.js-store-copy');
    if (copy) copy.textContent = 'Installs in one click and updates automatically.';
  }

  // Lightbox for the screenshots.
  const box = document.getElementById('lightbox');
  if (box && typeof box.showModal === 'function') {
    const img = box.querySelector('img');
    document.querySelectorAll('.shot').forEach((btn) => {
      btn.addEventListener('click', () => {
        img.src = btn.dataset.full;
        img.alt = btn.dataset.alt || '';
        box.showModal();
      });
    });
    box.querySelector('.lightbox__close').addEventListener('click', () => box.close());
    box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
    box.addEventListener('close', () => { img.src = ''; });
  }

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
