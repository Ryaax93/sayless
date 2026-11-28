"""Recette navigateur de SAYLESS STUDIO (Chrome + authentificateur virtuel WebAuthn).

Démarre le Worker d'exploitation en local (workerd via `wrangler dev`, HTTPS, base D1 éphémère),
puis parcourt STUDIO comme le fondateur : inscription Face ID, inventaire guidé avec confirmation,
écrans principaux, iPhone (390 px) et ordinateur (1440 px). Vérifie l'absence d'erreur et de
violation CSP, la conservation du focus et l'annonce des écrans. Télécharge enfin une copie
chiffrée de test depuis l'écran Santé et la fait relire par scripts/restore-backup.mjs.

Aucune donnée réelle : base locale jetable, secrets générés à chaque exécution et jamais écrits
ailleurs que dans un dossier temporaire. Le capteur Face ID est simulé par Chrome : ce test ne
remplace pas l'essai sur un véritable iPhone.

Usage : python3 tests/browser/studio_e2e.py [dossier_captures]
"""
import base64, json, os, secrets, shutil, signal, subprocess, sys, tempfile, time, urllib.request, ssl

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PORT = 8788
ORIGIN = f"https://localhost:{PORT}"
SHOTS = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="studio-shots-")
SETUP = secrets.token_urlsafe(18)


def b64(n):
    return base64.urlsafe_b64encode(os.urandom(n)).decode().rstrip("=")


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True, text=True, **kw)


def main():
    os.makedirs(SHOTS, exist_ok=True)
    state = tempfile.mkdtemp(prefix="studio-d1-")
    vars_path = os.path.join(ROOT, "ops", ".dev.vars")
    if os.path.exists(vars_path):
        raise SystemExit("ops/.dev.vars existe déjà : arrêt pour ne rien écraser.")
    env = dict(os.environ, CI="true", WRANGLER_SEND_METRICS="false")
    run(["node", "ops/build-studio.mjs"])
    keys = tempfile.mkdtemp(prefix="studio-backup-")
    day = time.strftime("%Y-%m-%d", time.gmtime())
    run(["node", "tests/browser/make_backup.mjs", keys, day])
    try:
        with open(os.path.join(keys, "public.json")) as f:
            public = f.read()
        # Clés VAPID de test (jetables) : l'écran Santé contrôle la paire dans le vrai moteur workerd.
        vapid = json.loads(run(["node", "-e", VAPID_JS]).stdout)
        with open(vars_path, "w") as f:
            f.write("\n".join([f"APP_SECRET={b64(32)}", f"PII_KEY={b64(32)}", f"ADMIN_SETUP_CODE={SETUP}",
                               f"STUDIO_ORIGIN={ORIGIN}", "STUDIO_RP_ID=localhost", "ENVIRONMENT=local",
                               "TURNSTILE_BYPASS=test-only", f"BACKUP_PUBLIC_KEY='{public}'",
                               f"VAPID_PUBLIC_KEY={vapid['public']}", f"VAPID_PRIVATE_KEY={vapid['private']}",
                               "VAPID_SUBJECT=https://saylessbrand.fr"]) + "\n")
        run(["npx", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", state, "-c", "ops/wrangler.toml"], env=env)
        with open(os.path.join(keys, "metadata.json")) as f:
            metadata = f.read()
        run(["npx", "wrangler", "kv", "key", "put", f"daily/{day}", "--binding", "BACKUPS", "--path", os.path.join(keys, "copie.json"),
             "--metadata", metadata, "--local", "--persist-to", state, "-c", "ops/wrangler.toml"], env=env)
        # SAYLESS_WEBAUTHN_ENGINE=simplewebauthn : même recette avec la vérification Face ID supplémentaire par la bibliothèque.
        engine = ["--var", f"WEBAUTHN_ENGINE:{os.environ['SAYLESS_WEBAUTHN_ENGINE']}"] if os.environ.get("SAYLESS_WEBAUTHN_ENGINE") else []
        server = subprocess.Popen(["npx", "wrangler", "dev", "-c", "ops/wrangler.toml", "--local", "--persist-to", state,
                                   "--port", str(PORT), "--local-protocol", "https", "--ip", "127.0.0.1", *engine], cwd=ROOT, env=env,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, preexec_fn=os.setsid)
        try:
            wait_ready()
            browse(lambda: seed(state, env), keys, lambda: seed(state, env, SEED_FAILURES))
        finally:
            os.killpg(server.pid, signal.SIGTERM)
            server.wait(timeout=20)
    finally:
        if os.path.exists(vars_path):
            os.remove(vars_path)
        shutil.rmtree(state, ignore_errors=True)
        shutil.rmtree(keys, ignore_errors=True)
    print(f"Captures : {SHOTS}")


# Commandes de TEST insérées dans la base locale jetable (aucune donnée réelle) : une commande
# payée en point relais, une vente 1.0 « à vérifier » dont la pièce a été retirée par prudence.
SEED = """
INSERT INTO orders (id, number, reference, source, status, subtotal_cents, shipping_cents, total_cents, currency, stripe_session_id,
  created_at, paid_at, updated_at, shipping_method, relay_id, relay_label, relay_snapshot)
VALUES ('00000000-0000-4000-8000-000000000001', 1, 'SL-TEST-0001', 'storefront', 'paid', 7500, 490, 7990, 'eur', 'cs_test_e2e_1',
  strftime('%s','now') - 3600, strftime('%s','now') - 3600, strftime('%s','now'), 'relay', 'TEST-RELAY-1', 'Relais Test',
  '{"id":"TEST-RELAY-1","name":"Relais Test","network":"TEST","address":{"line1":"1 rue du Relais Test","line2":null,"postcode":"75016","city":"Paris","country":"FR"}}');
INSERT INTO order_items (order_id, line, product_id, sku, quantity, unit_price_cents) VALUES ('00000000-0000-4000-8000-000000000001', 1, 'pink-001', 'ZH-PINK-M', 1, 7500);
INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, note, at)
VALUES ('ZH-PINK-S', -1, 0, 'legacy_link_sale', 'link:cs_test_e2e_2', 'Vente 1.0 à vérifier : pièce retirée par prudence', strftime('%s','now'));
INSERT INTO orders (id, number, reference, source, status, review_reason, subtotal_cents, shipping_cents, total_cents, currency, stripe_session_id,
  created_at, paid_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000002', 2, 'SL-TEST-0002', 'legacy_link', 'review', 'settled_near_inventory', 7500, 0, 7500, 'eur',
  'cs_test_e2e_2', strftime('%s','now') - 600, strftime('%s','now') - 600, strftime('%s','now'));
INSERT INTO order_items (order_id, line, product_id, sku, quantity, unit_price_cents) VALUES ('00000000-0000-4000-8000-000000000002', 1, 'pink-001', 'ZH-PINK-S', 1, 7500);
"""


def seed(state, env, sql=None):
    run(["npx", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", state, "-c", "ops/wrangler.toml", "--command", sql or SEED], env=env)


VAPID_JS = ("const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);"
            "const pub = Buffer.from(await crypto.subtle.exportKey('raw', k.publicKey)).toString('base64url');"
            "console.log(JSON.stringify({ public: pub, private: (await crypto.subtle.exportKey('jwk', k.privateKey)).d }));")
VAPID_JS = f"(async () => {{ {VAPID_JS} }})()"

# État laissé par l'ancienne boucle des notifications push (avant le correctif du 27 novembre) :
# messages iPhone abandonnés, alerte de boucle encore en attente, alertes « technical » dans STUDIO.
SEED_FAILURES = " ".join([
    "INSERT INTO outbox (channel, dedupe, payload, status, attempts, next_at, at, last_error) VALUES",
    "('push', 'push:daily_report:e2e', '{\"kind\":\"daily_report\",\"title\":\"Rapport\",\"body\":\"Essai\"}', 'dead', 5, 0, 1800000000, 'aucune notification remise'),",
    "('push', 'push:technical:outbox:1', '{\"kind\":\"technical\",\"title\":\"Notification non distribuée\",\"body\":\"Canal push : échec après 5 essais.\"}', 'dead', 5, 0, 1800000000, 'aucune notification remise'),",
    "('push', 'push:technical:outbox:2', '{\"kind\":\"technical\",\"title\":\"Notification non distribuée\",\"body\":\"Canal push : échec après 5 essais.\"}', 'pending', 2, 4102444800, 1800000000, NULL);",
    "INSERT INTO notifications (kind, ref, level, title, body, at) VALUES",
    "('technical', 'outbox:1', 'critical', 'Notification non distribuée', 'Canal push : échec après 5 essais.', 1800000000),",
    "('technical', 'outbox:2', 'critical', 'Notification non distribuée', 'Canal push : échec après 5 essais.', 1800000000);",
])


def wait_ready():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    for _ in range(120):
        try:
            with urllib.request.urlopen(f"{ORIGIN}/health", context=ctx, timeout=2) as r:
                if r.status == 200:
                    return
        except Exception:
            time.sleep(0.5)
    raise SystemExit("le Worker local n'a pas démarré")


def browse(seed_orders, keys, seed_failures):
    problems = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-first-run", "--ignore-certificate-errors"])
        context = browser.new_context(ignore_https_errors=True, accept_downloads=True, viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="fr-FR",
                                      timezone_id="Europe/Paris")
        page = context.new_page()
        page.on("console", lambda m: problems.append(f"console {m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: problems.append(f"erreur page : {e}"))
        cdp = context.new_cdp_session(page)
        cdp.send("WebAuthn.enable")
        cdp.send("WebAuthn.addVirtualAuthenticator", {"options": {"protocol": "ctap2", "transport": "internal", "hasResidentKey": True,
                                                                  "hasUserVerification": True, "isUserVerified": True, "automaticPresenceSimulation": True}})
        shot = lambda name: page.screenshot(path=os.path.join(SHOTS, f"{name}.png"), full_page=True)

        page.goto(ORIGIN)
        page.wait_for_selector("#setup")
        shot("01-connexion")
        page.fill("#setup", SETUP)
        page.click("[data-action=enroll-check]")
        page.wait_for_selector("[data-action=enroll-create]")
        page.click("[data-action=enroll-create]")
        page.wait_for_selector(".codes li")
        assert page.locator(".codes li").count() == 10
        shot("02-codes")
        page.click("[data-action=codes-done]")
        page.wait_for_selector("#drop-title")
        assert page.evaluate("document.activeElement?.id") == "drop-title", "titre de l'écran focalisé"
        assert page.locator("#live").inner_text() == "Aujourd’hui"
        bars = page.locator("svg.strip rect.bar").count()
        assert bars == 26, f"26 barres théoriques attendues, {bars} trouvées"
        shot("03-aujourdhui")

        # Inventaire guidé : compteurs (focus conservé), validation avec confirmation Face ID.
        page.goto(f"{ORIGIN}/#/inventaire")
        page.wait_for_selector("[data-action=inc]")
        first = page.locator("[data-action=inc]").first
        for _ in range(3):
            first.click()
        fk = page.evaluate("document.activeElement?.dataset?.fk")
        assert fk and fk.startswith("inc:sku:"), f"focus perdu après le compteur ({fk})"
        incs = page.locator("[data-action=inc]")
        for i in range(1, 3):
            for _ in range(4):
                incs.nth(i).click()
        shot("04-inventaire")
        page.click("[data-action=save-inventory]")
        page.wait_for_selector("text=Inventaire enregistré", timeout=15000)
        shot("05-inventaire-enregistre")

        # Commandes : préparation saisie, puis décision sur une vente 1.0 à vérifier (Face ID).
        seed_orders()
        page.goto(f"{ORIGIN}/#/commandes")
        page.wait_for_selector("a.ticket")
        assert page.locator("a.ticket").count() == 2
        page.wait_for_timeout(400)
        shot("07a-commandes")
        page.goto(f"{ORIGIN}/#/commandes/00000000-0000-4000-8000-000000000001")
        page.wait_for_selector("[data-action=fulfil]")
        page.wait_for_timeout(300)
        shot("07b-commande-relais")
        page.click("[data-action=fulfil]")
        page.wait_for_selector("text=Suivi mis à jour.")
        assert page.locator("[data-action=fulfil][data-value=shipped]").count() == 1, "étape suivante : expédition"
        shot("07c-commande-preparee")
        page.goto(f"{ORIGIN}/#/commandes/00000000-0000-4000-8000-000000000002")
        page.wait_for_selector("[data-fk=restore]")
        page.wait_for_timeout(300)
        shot("07d-commande-a-verifier")
        page.wait_for_timeout(1000)
        page.click("[data-fk=restore]")
        page.wait_for_selector("text=Commande validée", timeout=15000)
        shot("07e-commande-validee")

        for route, name, selector in [("#/", "06-aujourdhui-apres", "#drop-title"), ("#/stock", "08-stock", ".grid"),
                                      ("#/finances", "09-finances", "#fin-invest"), ("#/plus", "10-plus", "nav.sheet"), ("#/notifications", "11-notifications", ".sheet"),
                                      ("#/drops", "12-drops", "#np-name"), ("#/performances", "13-performances", ".sizebar, .sheet"),
                                      ("#/sante", "14-sante", ".sheet"), ("#/reglages", "15-reglages", ".seg"), ("#/historique", "16-historique", ".sheet"),
                                      ("#/demandes", "17-demandes", ".list")]:
            page.goto(f"{ORIGIN}/{route}")
            page.wait_for_selector(selector)
            page.wait_for_timeout(900)
            shot(name)
        # Sauvegarde : copie listée, téléchargée sous Face ID, identique à celle du stockage, relisible.
        page.goto(f"{ORIGIN}/#/sante")
        page.wait_for_selector("[data-action=backup-download]")
        page.wait_for_timeout(600)
        with page.expect_download() as info:
            page.click("[data-action=backup-download]")
        target = os.path.join(keys, "telechargee.json")
        info.value.save_as(target)
        with open(target) as a, open(os.path.join(keys, "copie.json")) as b:
            assert a.read() == b.read(), "copie téléchargée différente de la copie stockée"
        page.wait_for_selector("text=Copie téléchargée")
        shot("14b-sante-sauvegarde")
        drill = run(["node", "scripts/restore-backup.mjs", "--backup", target, "--key", os.path.join(keys, "private.json")])
        assert "Contrôle réussi" in drill.stdout, drill.stdout + drill.stderr

        # Notifications iPhone : clés contrôlées dans workerd, aucun appareil = en attente (pas une
        # panne). Clôture des envois échoués de l'ancienne boucle, sous Face ID, historique conservé.
        page.goto(f"{ORIGIN}/#/notifications")
        page.wait_for_selector("text=Sur cet iPhone")
        page.wait_for_timeout(600)
        shot("11b-notifications-iphone")
        seed_failures()
        page.goto(f"{ORIGIN}/#/sante")
        page.wait_for_selector("[data-action=outbox-close]")
        line = page.locator(".row", has_text="Notifications iPhone").first.inner_text()
        assert "Aucun iPhone abonné" in line, line
        assert "3 envois à clôturer" in page.locator("#echecs + .sheet").inner_text()
        page.wait_for_timeout(600)
        shot("14c-sante-envois-echoues")
        page.once("dialog", lambda d: d.accept())
        page.click("[data-action=outbox-close]")
        page.wait_for_selector("text=L’historique est conservé", timeout=15000)
        assert page.locator("[data-action=outbox-close]").count() == 0, "plus rien à clôturer"
        shot("14d-sante-clotures")
        page.goto(f"{ORIGIN}/#/historique")
        page.wait_for_selector("text=Envois échoués clôturés")

        page.goto(f"{ORIGIN}/#/")
        page.wait_for_selector("#drop-title")
        available = page.locator("svg.strip rect.bar.available").count()
        assert available == 11, f"11 pièces à vendre attendues (pièce mise de côté remise en vente), {available}"

        page.set_viewport_size({"width": 1440, "height": 920})
        page.goto(f"{ORIGIN}/#/")
        page.wait_for_selector("nav.side .navlink.on")
        page.wait_for_timeout(900)
        shot("20-ordinateur-aujourdhui")
        page.goto(f"{ORIGIN}/#/stock")
        page.wait_for_selector(".grid")
        shot("21-ordinateur-stock")
        browser.close()
    real = [x for x in problems if "favicon" not in x]
    if real:
        raise SystemExit("Problèmes dans le navigateur :\n" + "\n".join(real))
    print("Recette STUDIO dans Chrome : OK (aucune erreur, aucune violation CSP)")


if __name__ == "__main__":
    main()
