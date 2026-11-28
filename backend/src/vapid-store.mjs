// Base de coordination du jeton VAPID (table vapid_tokens) : la liaison D1 du Worker (`env.DB`),
// partagée par toutes ses instances. En production, `env.DB` est toujours fourni et le repli reste
// vide. Le banc de test y place une base D1 locale (Miniflare) pour les appels directs qui ne
// passent pas `env.DB` : les « démarrages à froid » simulés partagent alors cette base comme les
// instances partagent la vraie liaison. Sans aucune base : aucun jeton n'est émis.
let fallback = null;
export function setVapidStore(db) {
  fallback = db ?? null;
}
export const vapidStore = (env) => env?.DB ?? fallback;
