# Référence historique de tests uniquement

Les trois modules de `server/` et les deux migrations de `drizzle/` ont été déplacés ici sans changement métier. `tests/inventory.test.mjs` conserve ses 16 tests et importe cette référence explicitement.

Ces fichiers ne constituent pas un serveur déployable. Aucun script de lancement, build, Pages Function ou Worker ne les importe. Ils ne sont pas copiés dans les sorties de construction. Ne jamais appliquer ces migrations à la base cible : seules celles de `backend/migrations/` font autorité.

Retrait de l'ancien backend autorisé par la proposition de Claude dans `docs/DEPENDANCES.md`, §3, et par la mission de nettoyage du fondateur. L'historique Git conserve les autres fichiers supprimés.
