/* Politique de lecture partagée entre l'interface et ses tests. */
(function (root) {
  const IDLE_MS = 10 * 60 * 1000,
    POLL_MS = 20000;
  function mayRead({ hidden, route, cartOpen, lastActivity, retryAt = 0, now = Date.now() }) {
    return (
      !hidden &&
      (cartOpen || ['produit', 'paiement'].includes(route)) &&
      now - lastActivity < IDLE_MS &&
      now >= retryAt
    );
  }
  const api = Object.freeze({ mayRead, IDLE_MS, POLL_MS });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SaylessInventoryPolicy = api;
})(typeof window === 'undefined' ? globalThis : window);
