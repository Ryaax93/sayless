-- Décisions du fondateur du 24 novembre 2026 : zones livrées, conservation des données, sauvegardes.

-- Zones : France métropolitaine. Corse (20…) et outre-mer (97…, 98…) exclus tant que les conditions
-- du transporteur choisi ne sont pas vérifiées ; Monaco exclu (pays MC non accepté).
INSERT INTO settings (key, value) VALUES
  ('shipping_countries', 'FR'),
  ('excluded_postcode_prefixes', '20,97,98'),
  -- Conservation (proposition à valider : la purge automatique reste coupée tant que retention_enabled = 0).
  ('retention_enabled', '0'),
  ('contact_archive_days', '90'),
  ('contact_delete_days', '913'),
  ('access_log_days', '365'),
  ('client_hash_days', '30'),
  -- Sauvegardes chiffrées hors de la base principale.
  ('backup_daily_keep', '30'),
  ('backup_monthly_keep', '12'),
  ('backup_last_date', '');
--> statement-breakpoint
-- Coordonnées archivées : visibles seulement par une consultation explicite et journalisée.
ALTER TABLE order_contacts ADD COLUMN archived_at INTEGER;
--> statement-breakpoint
-- Journal en ajout seul, sauf les traces d'accès de plus d'un an (recommandation CNIL : 6 mois à
-- 1 an). Les actions sur le stock, l'argent et les exports restent conservées avec la comptabilité.
DROP TRIGGER audit_no_delete;
--> statement-breakpoint
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
WHEN NOT (OLD.action IN ('view_customer_contact', 'view_archived_contact', 'session_login', 'session_failed')
  AND OLD.at < CAST(strftime('%s', 'now') AS INTEGER) - 31536000)
BEGIN SELECT RAISE(ABORT, 'audit_append_only'); END;
