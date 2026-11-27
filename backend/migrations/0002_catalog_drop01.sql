-- Catalogue du DROP 01, repris de data/products.json (prix approuvé par le fondateur, 75 € TTC).
-- Aucune quantité : les tailles existent mais restent invendables tant que l'inventaire physique
-- n'est pas saisi et confirmé dans STUDIO (inventory.confirmed_at reste NULL).

INSERT INTO products (id, drop_id, name, price_cents, status)
VALUES ('pink-001', 'drop-01', 'Zip Hoodie Pink 001', 7500, 'published');
--> statement-breakpoint
INSERT INTO variants (sku, product_id, color, size, position) VALUES
  ('ZH-PINK-S', 'pink-001', 'pastel-pink', 'S', 1),
  ('ZH-PINK-M', 'pink-001', 'pastel-pink', 'M', 2),
  ('ZH-PINK-L', 'pink-001', 'pastel-pink', 'L', 3);
--> statement-breakpoint
INSERT INTO inventory (sku) VALUES ('ZH-PINK-S'), ('ZH-PINK-M'), ('ZH-PINK-L');
--> statement-breakpoint
-- Tarifs validés pour une pièce : point relais 4,90 €, Colissimo domicile 8,50 €.
INSERT INTO shipping_rates (method, cents, label) VALUES
  ('relay', 490, 'Point relais'),
  ('home', 850, 'Colissimo domicile');
--> statement-breakpoint
-- Valeurs du menu « taille » du lien 1.0 : à revérifier sur le lien réel avant la bascule.
INSERT INTO legacy_link_sizes (value, sku) VALUES
  ('s', 'ZH-PINK-S'),
  ('m', 'ZH-PINK-M'),
  ('l', 'ZH-PINK-L');
