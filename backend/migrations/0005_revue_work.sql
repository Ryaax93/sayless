-- Corrections demandées par la revue de Work (25 novembre 2026) et gardes avant l'ouverture des ventes.
-- Aucune donnée réelle : les identifiants du lien 1.0 et la version des CGV sont saisis par le
-- fondateur dans STUDIO pour chaque environnement.

INSERT INTO settings (key, value) VALUES
  -- STUDIO : génération courante des passkeys (incrémentée à chaque code de secours) et empreinte du
  -- jeton remis à l'appareil qui a saisi le code (seul autorisé à inscrire la nouvelle passkey).
  ('studio_generation', '1'),
  ('studio_recovery_hash', ''),
  -- Lien de paiement 1.0 reconnu explicitement (identifiants plink_… et price_… du compte Stripe).
  ('legacy_payment_link_id', ''),
  ('legacy_link_price_id', ''),
  -- Vente 1.0 réglée dans les 24 h qui précèdent l'inventaire : soumise au fondateur.
  ('legacy_review_window_seconds', '86400'),
  -- Sauvegardes : dernière copie vérifiée et dernière erreur (affichées dans « Santé »).
  ('backup_last_verified_at', ''),
  ('backup_last_error', '');
--> statement-breakpoint

-- ---------- STUDIO : passkeys et sessions rattachées à une génération ----------
ALTER TABLE passkeys ADD COLUMN generation INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE passkeys ADD COLUMN revoked_at INTEGER;
--> statement-breakpoint
-- 0 par défaut : une session antérieure à cette migration n'appartient à aucune génération valide.
ALTER TABLE auth_sessions ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TRIGGER studio_passkey_admission BEFORE INSERT ON passkeys
WHEN NEW.generation IS NOT CAST((SELECT value FROM settings WHERE key = 'studio_generation') AS INTEGER)
  OR NEW.revoked_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'stale_generation'); END;
--> statement-breakpoint
-- Une session n'existe que pour une passkey active de la génération courante, même si une
-- connexion était en cours au moment où un code de secours a été utilisé.
CREATE TRIGGER studio_session_admission BEFORE INSERT ON auth_sessions
WHEN NEW.generation IS NOT CAST((SELECT value FROM settings WHERE key = 'studio_generation') AS INTEGER)
  OR NOT EXISTS (SELECT 1 FROM passkeys p WHERE p.id = NEW.passkey_id AND p.revoked_at IS NULL AND p.generation = NEW.generation)
BEGIN SELECT RAISE(ABORT, 'session_refused'); END;
--> statement-breakpoint
-- Code de secours consommé : dans la MÊME instruction, nouvelle génération, passkeys retirées,
-- sessions fermées, défis en cours annulés et inscription d'un nouvel appareil ouverte 15 minutes.
CREATE TRIGGER studio_recovery_used AFTER UPDATE OF used_at ON recovery_codes
WHEN OLD.used_at IS NULL AND NEW.used_at IS NOT NULL
BEGIN
  UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'studio_generation';
  UPDATE settings SET value = '' WHERE key = 'studio_recovery_hash';
  UPDATE passkeys SET revoked_at = NEW.used_at WHERE revoked_at IS NULL;
  UPDATE auth_sessions SET revoked_at = NEW.used_at WHERE revoked_at IS NULL;
  UPDATE auth_challenges SET used_at = NEW.used_at WHERE used_at IS NULL;
  UPDATE settings SET value = CAST(NEW.used_at + 900 AS TEXT) WHERE key = 'studio_enrollment_open_until';
END;
--> statement-breakpoint
CREATE INDEX idx_passkeys_active ON passkeys (revoked_at, generation);
--> statement-breakpoint

-- ---------- commandes : motif de revue, instantané du point relais ----------
ALTER TABLE orders ADD COLUMN review_reason TEXT;
--> statement-breakpoint
-- Adresse complète du point choisi, figée à la commande (JSON sans donnée personnelle).
ALTER TABLE orders ADD COLUMN relay_snapshot TEXT;
--> statement-breakpoint

-- ---------- CGV publiées et versionnées ----------
-- Texte conservé tel qu'accepté : jamais modifié ni supprimé. La version courante est
-- settings.terms_version ; elle est signée dans le devis et vérifiée au paiement.
CREATE TABLE terms_documents (
  version TEXT PRIMARY KEY CHECK (length(version) BETWEEN 1 AND 40),
  sha256 TEXT NOT NULL,
  body TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  actor TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER terms_final_u BEFORE UPDATE ON terms_documents
BEGIN SELECT RAISE(ABORT, 'terms_final'); END;
--> statement-breakpoint
CREATE TRIGGER terms_final_d BEFORE DELETE ON terms_documents
BEGIN SELECT RAISE(ABORT, 'terms_final'); END;
--> statement-breakpoint

-- ---------- admission d'une réservation : inventaire vérifié pour TOUT le produit, CGV publiées ----------
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
    WHERE COALESCE((SELECT value FROM settings WHERE key = 'terms_version'), '') = '';
  SELECT RAISE(ABORT, 'insufficient_stock')
    WHERE (SELECT on_hand - reserved FROM inventory WHERE sku = NEW.sku) < NEW.quantity;
  SELECT RAISE(ABORT, 'hold_limit')
    WHERE (SELECT COUNT(DISTINCT order_id) FROM reservations
           WHERE client_hash = NEW.client_hash AND status IN ('held', 'awaiting_payment') AND order_id <> NEW.order_id)
      >= CAST((SELECT value FROM settings WHERE key = 'max_holds_per_client') AS INTEGER);
END;
