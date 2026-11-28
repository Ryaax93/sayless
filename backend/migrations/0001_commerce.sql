-- SAYLESS 2.0 — source unique du stock, des commandes et des paiements (Cloudflare D1 / SQLite).
--
-- Règles de conception :
--  * Toute variation de stock passe par stock_movements, registre en ajout seul. inventory n'est
--    modifié que par le déclencheur mv_apply ; une mise à jour directe est refusée.
--  * Les décisions (stock suffisant, boutique ouverte, transitions autorisées) sont dans la base :
--    chaque écriture est un lot atomique D1, sans transaction interactive.
--  * Interdit : INSERT OR IGNORE / OR REPLACE sur une table qui déclenche un mouvement de stock.
--    SQLite propage IGNORE aux déclencheurs et saute alors le contrôle reserved <= on_hand.
--  * Ce fichier ne contient aucune quantité réelle, aucun montant encaissé, aucune donnée client.
--  * Les instructions sont séparées par le marqueur ci-dessous (lu par les tests ; commentaire pour D1).

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
--> statement-breakpoint
-- Boutique fermée et paiements coupés par défaut : seul le fondateur les ouvre, depuis STUDIO.
INSERT INTO settings (key, value) VALUES
  ('shop_mode', 'paused'),
  ('payments_enabled', '0'),
  ('low_stock_threshold', '2'),
  ('max_holds_per_client', '2'),
  ('max_items_per_order', '1'),
  ('hold_seconds', '1920'),
  ('stripe_session_seconds', '1830'),
  ('quote_seconds', '600'),
  ('terms_version', ''),
  ('report_last_date', ''),
  ('legacy_link_size_field', 'choisistataille');
--> statement-breakpoint
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  drop_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'published', 'archived'))
);
--> statement-breakpoint
CREATE TABLE variants (
  sku TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id),
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, color, size)
);
--> statement-breakpoint
CREATE TABLE shipping_rates (
  method TEXT PRIMARY KEY CHECK (method IN ('relay', 'home')),
  cents INTEGER NOT NULL CHECK (cents >= 0),
  label TEXT NOT NULL
);
--> statement-breakpoint
-- on_hand : pièces vendables présentes (réservations comprises). reserved : pièces en cours de paiement.
-- confirmed_at reste NULL tant que l'inventaire physique de la taille n'est pas validé : rien n'est vendable.
CREATE TABLE inventory (
  sku TEXT PRIMARY KEY REFERENCES variants (sku),
  on_hand INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  confirmed_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 0,
  CHECK (reserved <= on_hand)
);
--> statement-breakpoint
CREATE TRIGGER inv_via_ledger_only BEFORE UPDATE OF on_hand, reserved ON inventory
WHEN NEW.revision <> OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'inventory_via_ledger_only'); END;
--> statement-breakpoint
CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL REFERENCES variants (sku),
  d_on_hand INTEGER NOT NULL,
  d_reserved INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('inventory_count', 'adjustment', 'hold', 'release', 'sale',
    'late_sale', 'legacy_link_sale', 'imported_sale', 'return_restock')),
  ref TEXT NOT NULL UNIQUE,
  note TEXT,
  actor TEXT NOT NULL DEFAULT 'system',
  at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER mv_known_sku BEFORE INSERT ON stock_movements
WHEN NOT EXISTS (SELECT 1 FROM inventory WHERE sku = NEW.sku)
BEGIN SELECT RAISE(ABORT, 'unknown_sku'); END;
--> statement-breakpoint
CREATE TRIGGER mv_apply AFTER INSERT ON stock_movements BEGIN
  UPDATE inventory
  SET on_hand = on_hand + NEW.d_on_hand, reserved = reserved + NEW.d_reserved, revision = revision + 1
  WHERE sku = NEW.sku;
END;
--> statement-breakpoint
CREATE TRIGGER mv_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'ledger_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER mv_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'ledger_append_only'); END;
--> statement-breakpoint
-- number : numéro séquentiel attribué au paiement (STUDIO, comptabilité) ;
-- reference : identifiant public aléatoire, non énumérable, montré au client.
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  number INTEGER UNIQUE,
  reference TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('storefront', 'legacy_link', 'import')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'awaiting_payment', 'paid', 'paid_no_stock', 'review',
    'expired', 'failed', 'refunded', 'partially_refunded')),
  idempotency_key TEXT UNIQUE,
  request_fingerprint TEXT,
  shipping_method TEXT CHECK (shipping_method IN ('relay', 'home')),
  relay_id TEXT,
  relay_label TEXT,
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  shipping_cents INTEGER NOT NULL CHECK (shipping_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'eur',
  terms_version TEXT,
  stripe_session_id TEXT UNIQUE,
  stripe_session_url TEXT,
  stripe_expires_at INTEGER,
  stripe_payment_intent TEXT,
  needs_stripe_check INTEGER NOT NULL DEFAULT 0 CHECK (needs_stripe_check IN (0, 1)),
  stripe_fee_cents INTEGER,
  amount_refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_refunded_cents >= 0),
  customer_name TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  paid_at INTEGER,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER od_guard BEFORE UPDATE OF status ON orders
WHEN NOT (OLD.status = NEW.status
  OR (OLD.status = 'pending' AND NEW.status IN ('awaiting_payment', 'paid', 'paid_no_stock', 'review', 'expired', 'failed'))
  OR (OLD.status = 'awaiting_payment' AND NEW.status IN ('paid', 'paid_no_stock', 'review', 'expired', 'failed'))
  OR (OLD.status IN ('expired', 'failed') AND NEW.status IN ('paid', 'paid_no_stock', 'review'))
  OR (OLD.status = 'paid_no_stock' AND NEW.status IN ('paid', 'refunded', 'partially_refunded', 'review'))
  OR (OLD.status = 'review' AND NEW.status IN ('paid', 'paid_no_stock', 'refunded', 'partially_refunded', 'expired'))
  OR (OLD.status IN ('paid', 'partially_refunded') AND NEW.status IN ('refunded', 'partially_refunded', 'review')))
BEGIN SELECT RAISE(ABORT, 'order_transition_forbidden'); END;
--> statement-breakpoint
-- sku NULL : uniquement pour une vente importée dont la taille n'a jamais été connue.
CREATE TABLE order_items (
  order_id TEXT NOT NULL REFERENCES orders (id),
  line INTEGER NOT NULL,
  product_id TEXT NOT NULL REFERENCES products (id),
  sku TEXT REFERENCES variants (sku),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  PRIMARY KEY (order_id, line),
  UNIQUE (order_id, sku)
);
--> statement-breakpoint
CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id),
  sku TEXT NOT NULL REFERENCES variants (sku),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  client_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('held', 'awaiting_payment', 'converted', 'released')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (order_id, sku)
);
--> statement-breakpoint
-- Admission d'une réservation : l'ordre des contrôles donne un code d'erreur déterministe.
CREATE TRIGGER rs_admission BEFORE INSERT ON reservations BEGIN
  SELECT RAISE(ABORT, 'not_held') WHERE NEW.status <> 'held';
  SELECT RAISE(ABORT, 'paused')
    WHERE (SELECT value FROM settings WHERE key = 'shop_mode') IS NOT 'open';
  SELECT RAISE(ABORT, 'not_published')
    WHERE (SELECT p.status FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = NEW.sku) IS NOT 'published';
  SELECT RAISE(ABORT, 'stock_unverified')
    WHERE (SELECT confirmed_at FROM inventory WHERE sku = NEW.sku) IS NULL;
  SELECT RAISE(ABORT, 'insufficient_stock')
    WHERE (SELECT on_hand - reserved FROM inventory WHERE sku = NEW.sku) < NEW.quantity;
  SELECT RAISE(ABORT, 'hold_limit')
    WHERE (SELECT COUNT(DISTINCT order_id) FROM reservations
           WHERE client_hash = NEW.client_hash AND status IN ('held', 'awaiting_payment') AND order_id <> NEW.order_id)
      >= CAST((SELECT value FROM settings WHERE key = 'max_holds_per_client') AS INTEGER);
END;
--> statement-breakpoint
CREATE TRIGGER rs_hold AFTER INSERT ON reservations BEGIN
  INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, at)
  VALUES (NEW.sku, 0, NEW.quantity, 'hold', 'hold:' || NEW.id, NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER rs_guard BEFORE UPDATE OF status ON reservations
WHEN NOT (OLD.status = NEW.status
  OR (OLD.status = 'held' AND NEW.status IN ('awaiting_payment', 'converted', 'released'))
  OR (OLD.status = 'awaiting_payment' AND NEW.status IN ('converted', 'released'))
  OR (OLD.status = 'released' AND NEW.status = 'converted'))
BEGIN SELECT RAISE(ABORT, 'reservation_transition_forbidden'); END;
--> statement-breakpoint
CREATE TRIGGER rs_release AFTER UPDATE OF status ON reservations
WHEN NEW.status = 'released' AND OLD.status IN ('held', 'awaiting_payment') BEGIN
  INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, at)
  VALUES (NEW.sku, 0, -NEW.quantity, 'release', 'release:' || NEW.id, NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER rs_sale AFTER UPDATE OF status ON reservations
WHEN NEW.status = 'converted' AND OLD.status IN ('held', 'awaiting_payment') BEGIN
  INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, at)
  VALUES (NEW.sku, -NEW.quantity, -NEW.quantity, 'sale', 'sale:' || NEW.id, NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER rs_late_sale AFTER UPDATE OF status ON reservations
WHEN NEW.status = 'converted' AND OLD.status = 'released' BEGIN
  INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, at)
  VALUES (NEW.sku, -NEW.quantity, 0, 'late_sale', 'late_sale:' || NEW.id, NEW.updated_at);
END;
--> statement-breakpoint
-- Coordonnées de livraison scellées (AES-GCM) : purgeables sans toucher à la comptabilité.
CREATE TABLE order_contacts (
  order_id TEXT PRIMARY KEY REFERENCES orders (id),
  sealed TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE shipments (
  order_id TEXT PRIMARY KEY REFERENCES orders (id),
  method TEXT NOT NULL CHECK (method IN ('relay', 'home')),
  label_status TEXT NOT NULL CHECK (label_status IN ('pending', 'bought', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  carrier_ref TEXT,
  tracking TEXT NOT NULL DEFAULT 'label'
    CHECK (tracking IN ('label', 'in_transit', 'available_at_relay', 'delivered', 'returned')),
  tracking_at INTEGER,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
-- Contrôle physique d'un retour : définitif, borné par la quantité vendue. Seul « revendable »
-- remet en stock. Un remboursement seul ne remet jamais une pièce en vente.
CREATE TABLE return_checks (
  order_id TEXT NOT NULL REFERENCES orders (id),
  sku TEXT NOT NULL REFERENCES variants (sku),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  resellable INTEGER NOT NULL CHECK (resellable IN (0, 1)),
  actor TEXT NOT NULL,
  note TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (order_id, sku)
);
--> statement-breakpoint
CREATE TRIGGER rc_bounds BEFORE INSERT ON return_checks BEGIN
  SELECT RAISE(ABORT, 'return_not_allowed')
    WHERE (SELECT status FROM orders WHERE id = NEW.order_id) NOT IN ('paid', 'refunded', 'partially_refunded');
  SELECT RAISE(ABORT, 'return_quantity_exceeded')
    WHERE NEW.quantity > COALESCE((SELECT quantity FROM order_items WHERE order_id = NEW.order_id AND sku = NEW.sku), 0);
END;
--> statement-breakpoint
CREATE TRIGGER rc_restock AFTER INSERT ON return_checks WHEN NEW.resellable = 1 BEGIN
  INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, note, actor, at)
  VALUES (NEW.sku, NEW.quantity, 0, 'return_restock', 'restock:' || NEW.order_id || ':' || NEW.sku,
          NEW.note, NEW.actor, NEW.at);
END;
--> statement-breakpoint
CREATE TRIGGER rc_final_u BEFORE UPDATE ON return_checks
BEGIN SELECT RAISE(ABORT, 'return_check_final'); END;
--> statement-breakpoint
CREATE TRIGGER rc_final_d BEFORE DELETE ON return_checks
BEGIN SELECT RAISE(ABORT, 'return_check_final'); END;
--> statement-breakpoint
CREATE TABLE processed_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  at INTEGER NOT NULL
);
--> statement-breakpoint
-- Centre de notifications STUDIO (et alertes) : une seule entrée par (kind, ref).
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  at INTEGER NOT NULL,
  read_at INTEGER,
  resolved_at INTEGER,
  UNIQUE (kind, ref)
);
--> statement-breakpoint
-- File d'envoi externe (Discord, push, e-mail) : au moins une fois, sans doublon par clé.
CREATE TABLE outbox (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('discord', 'push', 'email')),
  dedupe TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  result TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_append_only'); END;
--> statement-breakpoint
CREATE TABLE rate_limits (
  k TEXT NOT NULL,
  win INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (k, win)
);
--> statement-breakpoint
-- Assertions de lot : une insertion qui doit échouer fait annuler tout le lot D1.
CREATE TABLE assertions (code TEXT NOT NULL);
--> statement-breakpoint
CREATE TRIGGER assert_stale_revision BEFORE INSERT ON assertions WHEN NEW.code = 'stale_revision'
BEGIN SELECT RAISE(ABORT, 'stale_revision'); END;
--> statement-breakpoint
CREATE TRIGGER assert_other BEFORE INSERT ON assertions WHEN NEW.code <> 'stale_revision'
BEGIN SELECT RAISE(ABORT, 'assertion_failed'); END;
--> statement-breakpoint
-- Correspondance du menu « taille » de l'ancien lien de paiement 1.0 (filet de sécurité).
CREATE TABLE legacy_link_sizes (
  value TEXT PRIMARY KEY,
  sku TEXT NOT NULL REFERENCES variants (sku)
);
--> statement-breakpoint
CREATE INDEX idx_reservations_order ON reservations (order_id);
--> statement-breakpoint
CREATE INDEX idx_reservations_client ON reservations (client_hash, status);
--> statement-breakpoint
CREATE INDEX idx_orders_sweep ON orders (status, expires_at);
--> statement-breakpoint
CREATE INDEX idx_orders_intent ON orders (stripe_payment_intent);
--> statement-breakpoint
CREATE INDEX idx_outbox_due ON outbox (status, next_at);
