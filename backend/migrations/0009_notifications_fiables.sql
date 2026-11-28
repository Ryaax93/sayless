-- Correctif des notifications push (27 novembre 2026, essais réels sur Cloudflare TEST) : un message
-- abandonné déclenchait une alerte renvoyée par le même canal, abandonnée à son tour, et ainsi de
-- suite toutes les 31 minutes. Migration uniquement additive : aucune table recréée, aucune ligne
-- effacée ni modifiée ; l'historique reste entier.
--
-- État de chaque canal externe : un incident ouvert au plus (alerte au début, puis une par jour au
-- plus), code de la dernière erreur sans adresse ni secret, dernier envoi réussi.
CREATE TABLE channel_health (
  channel TEXT PRIMARY KEY CHECK (channel IN ('discord', 'push', 'email')),
  state TEXT NOT NULL DEFAULT 'ok' CHECK (state IN ('ok', 'failing')),
  since INTEGER NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  alerted_at INTEGER,
  last_ok_at INTEGER
);
--> statement-breakpoint
-- Abonnements iPhone : un abonnement expiré (404, 410) ou créé avec une autre clé VAPID n'est plus
-- supprimé en silence. Il reste visible dans le diagnostic de STUDIO, sans plus servir.
ALTER TABLE push_subscriptions ADD COLUMN expired_at INTEGER;
--> statement-breakpoint
ALTER TABLE push_subscriptions ADD COLUMN last_attempt_at INTEGER;
--> statement-breakpoint
ALTER TABLE push_subscriptions ADD COLUMN last_status INTEGER;
--> statement-breakpoint
ALTER TABLE push_subscriptions ADD COLUMN last_error TEXT;
--> statement-breakpoint
-- Envois échoués clôturés (par le fondateur sous Face ID, ou « aucun appareil ») : la ligne reste
-- dans la file comme historique, elle ne compte plus comme message non distribué.
ALTER TABLE outbox ADD COLUMN closed_at INTEGER;
--> statement-breakpoint
ALTER TABLE outbox ADD COLUMN close_reason TEXT;
