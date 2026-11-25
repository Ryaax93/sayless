-- SAYLESS STUDIO (écrans de gestion) et automatisations : drops déclarés, suivi des commandes,
-- demandes des clients, accès au suivi par lien e-mail, notifications sur iPhone.
-- Aucun chiffre réel ici : investissement, pièces reçues et offertes sont saisis dans STUDIO.

INSERT INTO settings (key, value) VALUES
  ('investment_cents', ''),
  ('contribution_rate_bp', ''),
  ('cron_last_run', ''),
  ('webhook_last_at', '');
--> statement-breakpoint
-- Drop : quantités déclarées par le fondateur (reçues, offertes) et total théorique avant
-- inventaire. Le stock vendable ne vient jamais d'ici : seulement de l'inventaire physique.
CREATE TABLE drops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  received_total INTEGER CHECK (received_total IS NULL OR received_total >= 0),
  gifted_total INTEGER CHECK (gifted_total IS NULL OR gifted_total >= 0),
  reference_total INTEGER CHECK (reference_total IS NULL OR reference_total >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO drops (id, name, received_total, gifted_total, reference_total, created_at, updated_at)
SELECT DISTINCT drop_id, 'Drop 01', NULL, NULL, 26, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER)
FROM products WHERE drop_id = 'drop-01';
--> statement-breakpoint
-- Préparation et expédition saisies dans STUDIO (avant le raccordement du transporteur, ou pour
-- les ventes du lien 1.0). Journal en ajout seul ; chaque étape une seule fois par commande.
CREATE TABLE order_events (
  id INTEGER PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id),
  kind TEXT NOT NULL CHECK (kind IN ('prepared', 'shipped', 'delivered', 'returned', 'review_resolved', 'refund', 'note')),
  detail TEXT,
  actor TEXT NOT NULL,
  at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX ux_order_events_once ON order_events (order_id, kind) WHERE kind IN ('prepared', 'shipped', 'delivered', 'returned');
--> statement-breakpoint
CREATE INDEX idx_order_events ON order_events (order_id, at);
--> statement-breakpoint
-- Une commande « à vérifier », non payée ou sans pièce n'est jamais préparée ni expédiée.
CREATE TRIGGER oe_shippable BEFORE INSERT ON order_events
WHEN NEW.kind IN ('prepared', 'shipped', 'delivered')
  AND (SELECT status FROM orders WHERE id = NEW.order_id) NOT IN ('paid', 'partially_refunded')
BEGIN SELECT RAISE(ABORT, 'order_not_shippable'); END;
--> statement-breakpoint
CREATE TRIGGER oe_no_update BEFORE UPDATE ON order_events
BEGIN SELECT RAISE(ABORT, 'ledger_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER oe_no_delete BEFORE DELETE ON order_events
BEGIN SELECT RAISE(ABORT, 'ledger_append_only'); END;
--> statement-breakpoint
-- Demandes des clients (contact, retour, rétractation) : coordonnées et message chiffrés.
CREATE TABLE customer_requests (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('contact', 'return', 'withdrawal')),
  order_reference TEXT,
  sealed TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'answered', 'closed')),
  ack_sent_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_requests_status ON customer_requests (status, created_at);
--> statement-breakpoint
-- Suivi de commande par lien e-mail : empreinte de l'adresse (jamais l'adresse en clair) et jetons
-- d'accès à durée limitée, stockés sous forme d'empreinte.
ALTER TABLE order_contacts ADD COLUMN email_hash TEXT;
--> statement-breakpoint
CREATE INDEX idx_contacts_email ON order_contacts (email_hash);
--> statement-breakpoint
CREATE TABLE order_access_tokens (
  token_hash TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
-- Notifications sur l'iPhone (Web Push, STUDIO installé sur l'écran d'accueil).
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER,
  failures INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
-- Inventaires guidés : chiffres saisis (à vendre, mises de côté) en plus du registre de stock.
CREATE TABLE inventory_counts (
  id INTEGER PRIMARY KEY,
  drop_id TEXT,
  counted INTEGER NOT NULL CHECK (counted >= 0),
  unshipped INTEGER NOT NULL DEFAULT 0 CHECK (unshipped >= 0),
  promised INTEGER NOT NULL DEFAULT 0 CHECK (promised >= 0),
  damaged INTEGER NOT NULL DEFAULT 0 CHECK (damaged >= 0),
  reference_total INTEGER,
  actor TEXT NOT NULL,
  at INTEGER NOT NULL
);
