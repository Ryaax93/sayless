-- Contre-revue v1.3 de Work (V13-B1, V13-B2, V13-C1).

-- V13-B1 : intentions d'e-mail durables. Écrites dans la même transaction que l'événement
-- (vente confirmée, demande enregistrée, colis expédié) ; la file d'envoi est alimentée ensuite.
-- Une panne entre les deux est réparée au passage suivant, jamais en double (clé unique).
-- Aucune donnée personnelle : la référence de la commande ou de la demande seulement.
CREATE TABLE mail_intents (
  dedupe TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('order_confirmation', 'request_ack', 'order_shipped')),
  ref TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  next_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  queued_at INTEGER
);
--> statement-breakpoint
CREATE INDEX idx_mail_intents_pending ON mail_intents (next_at) WHERE queued_at IS NULL;
--> statement-breakpoint

-- V13-B2 et C1 : la commande conserve l'empreinte des CGV acceptées. Une commande qui cite une
-- version ne peut citer qu'un document archivé, avec son empreinte exacte si elle est donnée.
ALTER TABLE orders ADD COLUMN terms_sha256 TEXT;
--> statement-breakpoint
CREATE TRIGGER orders_terms_archived BEFORE INSERT ON orders WHEN NEW.terms_version IS NOT NULL BEGIN
  SELECT RAISE(ABORT, 'terms_unpublished')
    WHERE NOT EXISTS (SELECT 1 FROM terms_documents d WHERE d.version = NEW.terms_version
      AND (NEW.terms_sha256 IS NULL OR d.sha256 = NEW.terms_sha256));
END;
--> statement-breakpoint

-- Réservation (dernier verrou, atomique) : les CGV en vigueur doivent exister dans l'archive, et
-- la commande doit citer exactement cette version et son empreinte. Une publication de CGV
-- concurrente entre le contrôle du devis et l'écriture est refusée ici (terms_outdated). La
-- reprise d'une tentative existante n'insère aucune réservation : elle n'est pas concernée.
DROP TRIGGER rs_admission;
--> statement-breakpoint
CREATE TRIGGER rs_admission BEFORE INSERT ON reservations BEGIN
  SELECT RAISE(ABORT, 'not_held') WHERE NEW.status <> 'held';
  SELECT RAISE(ABORT, 'paused')
    WHERE (SELECT value FROM settings WHERE key = 'shop_mode') IS NOT 'open';
  SELECT RAISE(ABORT, 'not_published')
    WHERE (SELECT p.status FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = NEW.sku) IS NOT 'published';
  SELECT RAISE(ABORT, 'stock_unverified')
    WHERE EXISTS (SELECT 1 FROM variants v LEFT JOIN inventory i ON i.sku = v.sku
      WHERE v.product_id = (SELECT product_id FROM variants WHERE sku = NEW.sku) AND (i.sku IS NULL OR i.confirmed_at IS NULL));
  SELECT RAISE(ABORT, 'terms_unpublished')
    WHERE NOT EXISTS (SELECT 1 FROM terms_documents d
      WHERE d.version = (SELECT value FROM settings WHERE key = 'terms_version'));
  SELECT RAISE(ABORT, 'terms_outdated')
    WHERE NOT EXISTS (SELECT 1 FROM orders o JOIN terms_documents d ON d.version = o.terms_version
      WHERE o.id = NEW.order_id AND o.terms_version = (SELECT value FROM settings WHERE key = 'terms_version')
        AND (o.terms_sha256 IS NULL OR o.terms_sha256 = d.sha256));
  SELECT RAISE(ABORT, 'insufficient_stock')
    WHERE (SELECT on_hand - reserved FROM inventory WHERE sku = NEW.sku) < NEW.quantity;
  SELECT RAISE(ABORT, 'hold_limit')
    WHERE (SELECT COUNT(DISTINCT order_id) FROM reservations
           WHERE client_hash = NEW.client_hash AND status IN ('held', 'awaiting_payment') AND order_id <> NEW.order_id)
      >= CAST((SELECT value FROM settings WHERE key = 'max_holds_per_client') AS INTEGER);
END;
