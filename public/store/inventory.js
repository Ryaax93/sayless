'use strict';
window.SaylessInventory = (() => {
  let snapshot = null,
    pending = null,
    lastActivity = Date.now(),
    retryAt = 0,
    expiryTimer = null;
  let variantsBySize = new Map();
  const eligible = () =>
    window.SaylessInventoryPolicy.mayRead({
      hidden: document.hidden,
      route: typeof currentRoute === 'function' ? currentRoute() : 'accueil',
      cartOpen: document.querySelector('#cart-dialog')?.open,
      lastActivity,
      retryAt,
    });
  function current() {
    return snapshot && Date.now() - snapshot.updatedAt < 30000 ? snapshot : null;
  }
  function paint() {
    const state = current(),
      available = state?.status === 'available',
      soldOut = state?.status === 'sold_out',
      held = state?.status === 'held',
      paused = state?.status === 'paused';
    const text = available
      ? state.total + ' gilet' + (state.total > 1 ? 's' : '') + ' disponible' + (state.total > 1 ? 's' : '')
      : soldOut
        ? 'DROP 01 — SOLD OUT.'
        : held
          ? 'Pièces réservées temporairement'
          : paused
            ? 'DROP 01 — TEMPORARILY UNAVAILABLE.'
            : 'Stock à confirmer';
    const note = available
      ? 'Disponibilité vérifiée. Les pièces réservées sont déjà déduites.'
      : soldOut
        ? 'Le stock du drop est épuisé, confirmation du système de gestion.'
        : held
          ? 'Des paiements sont en cours. La disponibilité sera actualisée.'
          : paused
            ? 'La boutique est momentanément indisponible. Retrouvez-nous prochainement sur saylessbrand.fr.'
            : 'La disponibilité ne peut pas être vérifiée. Aucun paiement n’est possible.';
    document.querySelectorAll('[data-stock-ticker]').forEach((el) => {
      const value = text.toLocaleUpperCase('fr-FR');
      if (el.textContent !== value) el.textContent = value;
      el.title = note;
    });
    document.querySelectorAll('[data-stock-accessible],[data-purchase-stock]').forEach((el) => {
      const value = text + '. ' + note;
      if (el.textContent !== value) el.textContent = value;
    });
    document.querySelectorAll('[data-drop-sold-out]').forEach((el) => {
      el.hidden = !soldOut;
    });
    document.querySelectorAll('[data-drop-paused]').forEach((el) => {
      el.hidden = !paused;
    });
    const box = document.querySelector('#product-stock');
    if (box) {
      box.dataset.state = state?.status || 'unavailable';
      box.querySelector('[data-stock-count]').textContent = text;
      box.querySelector('[data-stock-note]').textContent = note;
      document.querySelectorAll('[data-size]').forEach((button) => {
        const v = state?.variants.find((v) => v.sku === variantsBySize.get(button.dataset.size));
        button.disabled = !v || v.state !== 'available';
        const label =
          v?.state === 'sold_out'
            ? 'Épuisée'
            : v?.state === 'held'
              ? 'Réservée temporairement'
              : button.disabled
                ? 'Disponibilité à confirmer'
                : 'Disponible';
        button.title = label;
        button.setAttribute('aria-label', 'Taille ' + button.dataset.size + ' — ' + label);
        if (button.disabled && selectedSize === button.dataset.size) selectedSize = null;
        button.setAttribute('aria-pressed', String(button.dataset.size === selectedSize));
      });
      const label = document.querySelector('.size-label>.label');
      if (label) label.textContent = 'Ta taille' + (selectedSize ? ' : ' + selectedSize : '');
    }
    const add = document.querySelector('#add-to-cart');
    if (add) add.disabled = !available;
    const mobile = document.querySelector('[data-go-size]');
    if (mobile) mobile.disabled = !available;
    if (typeof window.SaylessCheckoutUI?.stockChanged === 'function') window.SaylessCheckoutUI.stockChanged();
  }
  async function refresh() {
    if (pending) return pending;
    if (!eligible()) {
      paint();
      return current();
    }
    pending = (async () => {
      try {
        const [catalog, data] = await Promise.all([
          window.SaylessCatalog.read(),
          window.SaylessAPI.stock('pink-001'),
        ]);
        variantsBySize = catalog?.variants || new Map();
        snapshot = window.SaylessAPIContract.normalizeStock(data, [...variantsBySize.values()]);
      } catch (e) {
        snapshot = null;
        retryAt = Date.now() + (e.retryAfterMs || 20000);
      } finally {
        pending = null;
        clearTimeout(expiryTimer);
        if (snapshot?.updatedAt)
          expiryTimer = setTimeout(paint, Math.max(1, 30001 - (Date.now() - snapshot.updatedAt)));
        paint();
      }
      return current();
    })();
    return pending;
  }
  function enter() {
    lastActivity = Date.now();
    paint();
    return refresh();
  }
  function canAdd(size, color, quantity) {
    const state = current();
    if (!state) {
      refresh();
      return false;
    }
    const v = state.variants.find((v) => v.sku === variantsBySize.get(size));
    return (
      state.status === 'available' &&
      color === 'Rose' &&
      quantity === 1 &&
      v?.state === 'available' &&
      v.orderable >= quantity
    );
  }
  function variantId(size, color) {
    return color === 'Rose'
      ? current()?.variants.find((v) => v.sku === variantsBySize.get(size))?.sku || null
      : null;
  }
  setInterval(() => {
    paint();
    if (eligible()) refresh();
  }, window.SaylessInventoryPolicy.POLL_MS);
  ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((type) =>
    document.addEventListener(
      type,
      () => {
        const idle = Date.now() - lastActivity >= window.SaylessInventoryPolicy.IDLE_MS;
        lastActivity = Date.now();
        if (idle && eligible()) refresh();
      },
      { passive: true },
    ),
  );
  document.addEventListener('visibilitychange', () => {
    paint();
    if (eligible()) refresh();
  });
  window.addEventListener('offline', () => {
    snapshot = null;
    paint();
  });
  window.addEventListener('online', () => {
    if (eligible()) refresh();
  });
  window.addEventListener('focus', () => {
    paint();
    if (eligible()) refresh();
  });
  return { refresh, enter, current, paint, canAdd, variantId };
})();
