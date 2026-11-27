// Écrans de SAYLESS STUDIO branchés sur la base : aujourd'hui, commandes, stock, finances,
// notifications, santé, réglages, drops, performances, demandes. Données de TEST uniquement.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createKV, event, fakeMail, PII, startDatabases, stopDatabases } from './helpers.mjs';
import { SoftAuthenticator, studio } from './studio-helpers.mjs';
import { deliverOutbox } from '../../backend/src/notify.mjs';
import { resendSender } from '../../backend/src/email.mjs';
import { encryptPush, pushSender, vapidAuthorization } from '../../backend/src/push.mjs';
import { b64url, fromB64url } from '../../backend/src/lib.mjs';
import { maybeDailyBackup, openBackup } from '../../backend/src/backup.mjs';

before(startDatabases);
after(stopDatabases);

// Banc STUDIO connecté (catalogue réel du DROP 01, quantités de test) avec confirmation Face ID.
async function signedIn(options = {}) {
  const b = await studio({}, { catalogSeed: true, ...options });
  const { auth } = await b.enroll();
  b.auth = auth;
  b.clock.t += 400; // la confirmation Face ID de l'inscription a expiré : chaque action sensible la redemande
  b.sensitive = async (method, path, body) => {
    await b.stepUp(auth);
    return b.call(method, path, body);
  };
  b.inventory = async (counts, aside = {}) => {
    const inv = (await b.call('GET', '/api/admin/inventory')).body;
    return b.sensitive('POST', '/api/admin/inventory', { counts, set_aside: { unshipped: 0, promised: 0, damaged: 0, ...aside },
      expected: Object.fromEntries(inv.variants.map((v) => [v.sku, v.revision])) });
  };
  return b;
}
const SKU = { S: 'ZH-PINK-S', M: 'ZH-PINK-M', L: 'ZH-PINK-L' };

test('U01 aujourd’hui : bande des pièces réelle, déclarations du fondateur, ventes 1.0 synchronisées, liste « à faire » calculée', async () => {
  const b = await signedIn({ mode: 'paused' });
  await b.real.prepare("UPDATE settings SET value = '' WHERE key IN ('legacy_payment_link_id', 'legacy_link_price_id')").run();
  let o = (await b.call('GET', '/api/admin/overview')).body;
  assert.equal(o.drop.id, 'drop-01');
  assert.deepEqual(o.drop.bars, [{ kind: 'todo', n: 26 }], 'avant inventaire : 26 théoriques à confirmer');
  assert.ok(['inventory', 'legacy', 'readiness'].every((id) => o.todo.some((t) => t.id === id)));
  assert.equal((await b.call('POST', '/api/admin/drops/declare', { drop_id: 'drop-01', received_total: 30, gifted_total: 2 })).body.error, 'stepup_required');
  assert.equal((await b.sensitive('POST', '/api/admin/drops/declare', { drop_id: 'drop-01', received_total: 30, gifted_total: 2 })).status, 200);
  // Lien 1.0 enregistré, puis ventes passées relues chez Stripe (une vente S avant l'inventaire).
  b.clock.t += 400;
  assert.equal((await b.call('POST', '/api/admin/settings', { legacy_payment_link_id: 'pas-un-lien' })).body.error, 'stepup_required');
  assert.equal((await b.sensitive('POST', '/api/admin/settings', { legacy_payment_link_id: 'pas-un-lien' })).body.error, 'invalid_request');
  await b.sensitive('POST', '/api/admin/settings', { legacy_payment_link_id: 'plink_testlien01', legacy_link_price_id: 'price_testlien01' });
  b.stripe.linkSession('s', 7500, PII, { link: 'plink_testlien01', price: 'price_testlien01' });
  const sync = await b.sensitive('POST', '/api/admin/legacy/sync', {});
  assert.deepEqual([sync.body.checked, sync.body.recorded], [1, 1]);
  assert.equal((await b.call('POST', '/api/admin/legacy/sync', {})).body.checked, 1, 'resynchroniser ne compte rien deux fois');
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE source = 'legacy_link'"), 1);
  o = (await b.call('GET', '/api/admin/overview')).body;
  assert.deepEqual(o.drop.bars, [{ kind: 'sold', n: 1 }, { kind: 'gift', n: 2 }, { kind: 'todo', n: 27 }]);
  // Inventaire : 3 S, 4 M, 2 L à vendre, 1 promise.
  const saved = await b.inventory({ [SKU.S]: 3, [SKU.M]: 4, [SKU.L]: 2 }, { promised: 1 });
  assert.deepEqual([saved.status, saved.body.stripe_limit_proposal], [200, 11]);
  o = (await b.call('GET', '/api/admin/overview')).body;
  assert.equal(o.drop.confirmed, true);
  assert.deepEqual(o.drop.bars, [{ kind: 'sold', n: 1 }, { kind: 'gift', n: 2 }, { kind: 'available', n: 9 }, { kind: 'aside', n: 1 }, { kind: 'gap', n: 17 }]);
  assert.ok(!o.todo.some((t) => t.id === 'inventory'));
  assert.ok(o.todo.find((t) => t.id === 'stripe_limit')?.wait, 'limite Stripe : action du fondateur chez Stripe, aucun bouton');
  assert.ok(o.todo.some((t) => t.id === 'confirm'), 'vente 1.0 : envoi à confirmer');
});

test('U02 commandes : filtres, détail réel, coordonnées sous Face ID, préparation, expédition, décision sur une commande à vérifier', async () => {
  const b = await signedIn();
  await b.inventory({ [SKU.S]: 2, [SKU.M]: 2, [SKU.L]: 1 });
  await b.buy(SKU.M, '10.140.0.1');
  await b.buy(SKU.S, '10.140.0.2', { shipping: 'relay', relay_id: 'TEST-RELAY-1' });
  await b.sensitive('POST', '/api/admin/settings', { legacy_payment_link_id: 'plink_testlien01', legacy_link_price_id: 'price_testlien01' });
  const near = b.stripe.linkSession('l', 7500, PII, { link: 'plink_testlien01', price: 'price_testlien01', settledAt: b.clock.now() - 3600 });
  b.stripe.sessions.get(near).created = b.clock.now() - 4000;
  b.clock.t += 60;
  await b.webhook(event('checkout.session.completed', near));
  const list = (await b.call('GET', '/api/admin/orders')).body;
  assert.deepEqual([list.counts.all, list.counts.prep, list.counts.review], [3, 2, 1]);
  const relayOrder = list.orders.find((o) => o.shipping === 'relay');
  b.clock.t += 400; // confirmation Face ID précédente expirée (5 minutes)
  assert.equal((await b.call('GET', '/api/admin/orders?q=client')).body.orders.length, 3, 'recherche par nom (clair, pour la comptabilité)');
  const detail = (await b.call('GET', `/api/admin/orders/${relayOrder.id}`)).body;
  assert.deepEqual([detail.total_cents, detail.fee_cents, detail.net_cents], [7990, Math.round(7990 * 0.015) + 25, 7990 - (Math.round(7990 * 0.015) + 25)]);
  assert.equal(detail.relay.address.line1, '1 rue du Relais Test');
  assert.deepEqual([detail.contact.stored, detail.actions.fulfil, detail.actions.resolve], [true, true, false]);
  assert.equal((await b.call('POST', `/api/admin/orders/${relayOrder.id}/contact`, {})).body.error, 'stepup_required');
  const contact = await b.sensitive('POST', `/api/admin/orders/${relayOrder.id}/contact`, {});
  assert.equal(contact.body.contact.email, PII.email);
  assert.equal(await b.count("SELECT COUNT(*) FROM audit_log WHERE action = 'view_customer_contact' AND target = ?", relayOrder.id), 1);
  for (const step of ['prepared', 'shipped', 'shipped', 'delivered']) {
    const r = await b.call('POST', `/api/admin/orders/${relayOrder.id}/fulfil`, { step, carrier: 'Transporteur test', tracking: 'TEST123456' });
    assert.equal(r.status, 200);
  }
  const done = (await b.call('GET', `/api/admin/orders/${relayOrder.id}`)).body;
  assert.deepEqual([done.stage, done.events.map((e) => e.kind)], ['Retirée', ['prepared', 'shipped', 'delivered']]);
  // Commande à vérifier (vente 1.0 réglée 1 h avant l'inventaire) : jamais préparée avant décision.
  const review = list.orders.find((o) => o.group === 'review');
  assert.match(review.review, /peu avant l’inventaire/);
  assert.equal((await b.call('POST', `/api/admin/orders/${review.id}/fulfil`, { step: 'prepared' })).body.error, 'order_not_shippable');
  const before = await b.inv(SKU.L);
  const restored = await b.sensitive('POST', `/api/admin/orders/${review.id}/resolve`, { decision: 'restore_piece' });
  assert.deepEqual([restored.body.status, restored.body.group], ['paid', 'confirm']);
  assert.deepEqual(await b.inv(SKU.L), [before[0] + 1, 0], 'la pièce mise de côté revient en vente');
  assert.equal((await b.sensitive('POST', `/api/admin/orders/${review.id}/resolve`, { decision: 'confirm' })).body.error, 'order_not_reviewable');
});

test('U03 remboursement et retour : décision du fondateur, idempotent, jamais de remise en stock sans contrôle physique', async () => {
  const b = await signedIn();
  await b.inventory({ [SKU.S]: 1, [SKU.M]: 1, [SKU.L]: 1 });
  await b.buy(SKU.M, '10.141.0.1');
  const id = (await b.call('GET', '/api/admin/orders')).body.orders[0].id;
  b.clock.t += 400; // confirmation Face ID précédente expirée (5 minutes)
  assert.equal((await b.call('POST', `/api/admin/orders/${id}/refund`, { amount_cents: 1000 })).body.error, 'stepup_required');
  assert.equal((await b.sensitive('POST', `/api/admin/orders/${id}/refund`, { amount_cents: 999999 })).body.error, 'invalid_request');
  const r1 = await b.call('POST', `/api/admin/orders/${id}/refund`, { amount_cents: 1000 });
  assert.equal(r1.body.refund.status, 'succeeded');
  const charge = [...b.stripe.charges.keys()][0];
  await b.webhook(event('charge.refunded', charge, 'charge'));
  let detail = (await b.call('GET', `/api/admin/orders/${id}`)).body;
  assert.deepEqual([detail.status, detail.refunded_cents], ['partially_refunded', 1000]);
  assert.deepEqual(await b.inv(SKU.M), [0, 0], 'remboursement seul : stock inchangé');
  const ret = await b.call('POST', `/api/admin/orders/${id}/return`, { sku: SKU.M, quantity: 1, resellable: true, note: 'retour contrôlé (test)' });
  assert.equal(ret.body.result, 'restocked');
  assert.equal((await b.call('POST', `/api/admin/orders/${id}/return`, { sku: SKU.M, quantity: 1, resellable: true })).body.result, 'already_done');
  assert.deepEqual(await b.inv(SKU.M), [1, 0]);
  detail = (await b.call('GET', `/api/admin/orders/${id}`)).body;
  assert.deepEqual(detail.events.map((e) => e.kind), ['refund', 'returned']);
});

test('U04 finances et exports : chiffres de la base, frais réels, investissement déclaré, exports journalisés', async () => {
  const b = await signedIn();
  await b.inventory({ [SKU.S]: 2, [SKU.M]: 2, [SKU.L]: 2 });
  await b.buy(SKU.S, '10.142.0.1');
  await b.buy(SKU.L, '10.142.0.2', { shipping: 'relay', relay_id: 'TEST-RELAY-1' });
  let f = (await b.call('GET', '/api/admin/finances')).body;
  const fees = Math.round(8350 * 0.015) + 25 + Math.round(7990 * 0.015) + 25;
  assert.deepEqual([f.sales, f.collected_cents, f.fees_cents, f.fees_unknown, f.net_cents, f.investment_cents, f.recovered_ratio],
    [2, 16340, fees, 0, 16340 - fees, null, null], 'aucun investissement inventé');
  f = (await b.sensitive('POST', '/api/admin/finances/settings', { investment_cents: 100000, contribution_rate_bp: 1230 })).body;
  assert.equal(f.recovered_ratio, (16340 - fees) / 100000);
  assert.equal(f.contribution_estimate_cents, Math.round(16340 * 1230 / 10000));
  assert.equal(f.cumulative.length, 1);
  const recettes = await b.call('POST', '/api/admin/exports/recettes', {});
  assert.match(recettes.body.csv, /^﻿Date;Référence;Client;Montant TTC/);
  const orders = await b.call('POST', '/api/admin/exports/orders', {});
  assert.equal(orders.body.csv.trim().split('\r\n').length, 3);
  assert.equal(await b.count("SELECT COUNT(*) FROM audit_log WHERE action IN ('export_livre_recettes', 'export_orders')"), 2);
});

test('U05 réglages : ouverture refusée tant qu’un prérequis manque, CGV publiées, seuil, codes régénérés, appareils', async () => {
  const b = await signedIn();
  let open = await b.sensitive('POST', '/api/admin/shop', { mode: 'open' });
  assert.equal(open.body.error, 'not_ready');
  assert.ok(open.body.checks.includes('inventory') && open.body.checks.includes('stripe'));
  await b.inventory({ [SKU.S]: 1, [SKU.M]: 1, [SKU.L]: 1 });
  b.env.STRIPE_SECRET_KEY = 'sk_test_cle_de_test_uniquement';
  const terms = await b.call('POST', '/api/admin/terms', { version: '2026-12-01', body: `CGV DE TEST — fictives. ${'Clause. '.repeat(40)}` });
  assert.equal(terms.body.terms.version, '2026-12-01');
  open = await b.call('POST', '/api/admin/shop', { mode: 'open' });
  assert.deepEqual([open.status, open.body.shop], [200, { mode: 'open', payments_enabled: true }]);
  assert.deepEqual((await b.call('POST', '/api/admin/shop', { mode: 'paused' })).body.shop, { mode: 'paused', payments_enabled: false });
  assert.equal((await b.call('POST', '/api/admin/settings', { low_stock_threshold: 3 })).body.low_stock_threshold, 3);
  // Codes de secours régénérés : les anciens ne servent plus.
  const old = await b.count('SELECT COUNT(*) FROM recovery_codes');
  const codes = (await b.call('POST', '/api/admin/recovery-codes', {})).body.recovery_codes;
  assert.deepEqual([old, codes.length, new Set(codes).size], [10, 10, 10]);
  // Second appareil (ordinateur) puis retrait ; le dernier appareil ne peut pas être retiré.
  const opts = await b.call('POST', '/api/admin/devices/options', {});
  const mac = new SoftAuthenticator();
  assert.equal((await b.call('POST', '/api/admin/devices/verify', { challenge_id: opts.body.challenge_id, credential: await mac.create(opts.body.publicKey), label: 'Mac' })).status, 200);
  let settings = (await b.call('GET', '/api/admin/settings')).body;
  assert.deepEqual(settings.devices.map((d) => d.label), ['Appareil principal', 'Mac']);
  const macId = settings.devices[1].id;
  assert.equal((await b.call('POST', '/api/admin/devices/revoke', { id: macId })).body.revoked, true);
  settings = (await b.call('GET', '/api/admin/settings')).body;
  assert.equal((await b.call('POST', '/api/admin/devices/revoke', { id: settings.devices[0].id })).body.error, 'last_device');
  b.forget();
  assert.equal((await b.login(mac)).body.error, 'unknown_credential');
});

test('U06 notifications, santé et historique : centre de notifications, canaux réels, contrôles, journal non modifiable', async () => {
  const b = await signedIn();
  await b.inventory({ [SKU.S]: 3, [SKU.M]: 3, [SKU.L]: 3 });
  await b.buy(SKU.M, '10.143.0.1');
  const n = (await b.call('GET', '/api/admin/notifications')).body;
  assert.ok(n.notifications.some((x) => x.kind === 'order_paid' && x.order_id));
  assert.deepEqual(n.channels, { discord: false, push: { configured: false, devices: 0, public_key: null }, email: false });
  assert.equal((await b.call('POST', '/api/admin/notifications/read', { all: true })).body.unread, 0);
  const h = (await b.call('GET', '/api/admin/health')).body;
  const byName = Object.fromEntries(h.checks.map((c) => [c.name, c.state]));
  assert.deepEqual([byName['Base de données'], byName['Tâches automatiques'], byName['Conservation des données']], ['ok', 'alert', 'wait']);
  const audit = (await b.call('GET', '/api/admin/audit')).body.entries.map((e) => e.action);
  assert.ok(audit.includes('inventory_count') && audit.includes('passkey_added'));
  const perf = (await b.call('GET', '/api/admin/performance')).body;
  assert.deepEqual([perf.sales, perf.by_size, perf.visits], [1, [{ size: 'M', quantity: 1 }], null]);
  const drops = (await b.call('GET', '/api/admin/drops')).body;
  assert.equal(drops.promo.supported, false, 'codes promo : pas de faux bouton');
  const draft = await b.sensitive('POST', '/api/admin/products', { id: 'drop02-noir', drop_id: 'drop-02', name: 'Produit test', price_cents: 8000, sizes: ['S', 'M'] });
  assert.equal(draft.body.product.status, 'draft');
  assert.equal((await b.api('GET', '/api/stock?product_id=drop02-noir')).body.error, 'unknown_product', 'brouillon invisible côté boutique');
});

test('U07 iPhone : abonnement validé, message chiffré (RFC 8291) déchiffrable par l’appareil, signature VAPID, appareil retiré si expiré', async () => {
  const b = await signedIn();
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', vapid.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey));
  Object.assign(b.env, { VAPID_PUBLIC_KEY: b64url(pub), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: 'mailto:test@example.invalid' });
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const sub = { endpoint: 'https://web.push.apple.com/QTEST', keys: { p256dh: b64url(uaPublic), auth: b64url(authSecret) } };
  assert.equal((await b.call('POST', '/api/admin/push/subscribe', { ...sub, endpoint: 'https://exemple.test/x' })).body.error, 'invalid_request');
  assert.equal((await b.call('POST', '/api/admin/push/subscribe', sub)).body.subscribed, true);
  // Déchiffrement côté appareil, selon RFC 8291 : prouve que le message envoyé est lisible.
  const body = await encryptPush({ p256dh: sub.keys.p256dh, auth: sub.keys.auth }, { title: 'Test', body: 'Message de test' });
  const salt = body.slice(0, 16);
  const asPublic = body.slice(21, 86);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, ua.privateKey, 256));
  const hk = async (s, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info: new Uint8Array(info) }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const te = new TextEncoder();
  const ikm = await hk(authSecret, shared, [...te.encode('WebPush: info\0'), ...uaPublic, ...asPublic], 32);
  const cek = await hk(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hk(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), body.slice(86)));
  assert.equal(plain.at(-1), 2, 'délimiteur du dernier enregistrement');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plain.slice(0, -1))), { title: 'Test', body: 'Message de test' });
  const authz = await vapidAuthorization(b.env, sub.endpoint, b.clock.now());
  const [, jwt, k] = authz.match(/^vapid t=([^,]+), k=(.+)$/);
  const [h, c, sig] = jwt.split('.');
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapid.publicKey, fromB64url(sig), te.encode(`${h}.${c}`)));
  assert.deepEqual([k, JSON.parse(new TextDecoder().decode(fromB64url(c))).aud], [b64url(pub), 'https://web.push.apple.com']);
  // Envoi : 201 = remis ; 410 = abonnement expiré, retiré.
  const calls = [];
  let status = 201;
  const send = pushSender(b.env, async (url, init) => { calls.push({ url, init }); return new Response(null, { status }); });
  await send({ kind: 'order_paid', level: 'info', title: 'Nouvelle commande', body: '1 × taille M' });
  assert.equal(calls[0].init.headers['Content-Encoding'], 'aes128gcm');
  status = 410;
  await assert.rejects(send({ kind: 'test', level: 'info', title: 't', body: 't' }));
  assert.equal(await b.count('SELECT COUNT(*) FROM push_subscriptions'), 0);
});

test('U08 demandes et suivi : accusé de réception par e-mail après enregistrement, lien de suivi sans énumération, e-mails de commande', async () => {
  const b = await signedIn();
  const mail = fakeMail();
  Object.assign(b.env, { RESEND_API_KEY: 're_test_uniquement', EMAIL_FROM: 'SAYLESS <commandes@example.invalid>' });
  b.deps.senders = { email: resendSender(b.env, mail.transport) };
  await b.inventory({ [SKU.S]: 2, [SKU.M]: 2, [SKU.L]: 2 });
  await b.buy(SKU.M, '10.144.0.1');
  const { ctx, deps } = b.context();
  await deliverOutbox(ctx, b.deps.senders, deps);
  assert.equal(mail.sent.length, 1, 'confirmation de commande au client');
  assert.match(mail.sent[0].body.subject, /^Commande SL-[0-9A-Z]{4}-[0-9A-Z]{4} confirmée$/);
  assert.deepEqual([mail.sent[0].body.to, mail.sent[0].headers['Idempotency-Key'].startsWith('email:order_confirmation:')], [[PII.email], true]);
  assert.equal(await b.count("SELECT COUNT(*) FROM outbox WHERE channel = 'email' AND payload LIKE ?", `%${PII.email}%`), 0, 'adresse chiffrée dans la file');
  const reference = await b.count('SELECT reference FROM orders');
  // Rétractation : enregistrée, référence renvoyée, accusé envoyé tout de suite.
  const withdrawal = await b.api('POST', '/api/requests', { body: { type: 'withdrawal', order_reference: reference, name: 'Client Test', email: PII.email, message: '', turnstile: 'jeton-test' } });
  assert.equal(withdrawal.status, 200);
  assert.match(withdrawal.body.reference, /^R-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.match(mail.sent.at(-1).body.text, /accusé de réception de ta rétractation/);
  assert.equal(await b.count('SELECT COUNT(*) FROM customer_requests WHERE sealed LIKE ?', `%${PII.email}%`), 0);
  assert.equal((await b.api('POST', '/api/requests', { body: { type: 'contact', name: 'x', email: PII.email, message: '', turnstile: 'jeton-test' } })).body.field, 'message');
  // Suivi : même réponse pour une commande inconnue ou une mauvaise adresse ; lien seulement si tout correspond.
  const before = mail.sent.length;
  for (const body of [{ reference: 'SL-0000-0000', email: PII.email }, { reference, email: 'autre@example.invalid' }]) {
    assert.deepEqual((await b.api('POST', '/api/order/lookup', { body })).body, { accepted: true });
  }
  assert.equal(mail.sent.length, before);
  await b.api('POST', '/api/order/lookup', { body: { reference, email: PII.email.toUpperCase() } });
  const token = mail.sent.at(-1).body.text.match(/#\/suivi\?t=([A-Za-z0-9_-]+)/)[1];
  const order = await b.api('GET', '/api/order', { headers: { Authorization: `Bearer ${token}` } });
  assert.deepEqual([order.status, order.body.payment_status, order.body.items], [200, 'paid', [{ size: 'M', quantity: 1 }]]);
  assert.ok(!JSON.stringify(order.body).includes(PII.email) && !JSON.stringify(order.body).includes(PII.name), 'aucune donnée personnelle');
  assert.equal((await b.api('GET', '/api/order', { headers: { Authorization: 'Bearer faux-jeton-faux-jeton-faux-jeton-faux-jeton' } })).status, 401);
  b.clock.t += 1801;
  assert.equal((await b.api('GET', '/api/order', { headers: { Authorization: `Bearer ${token}` } })).status, 401, 'lien expiré après 30 minutes');
  // Expédition saisie dans STUDIO : e-mail « en route » avec le numéro de suivi.
  const id = (await b.call('GET', '/api/admin/orders')).body.orders[0].id;
  await b.call('POST', `/api/admin/orders/${id}/fulfil`, { step: 'shipped', carrier: 'Transporteur test', tracking: 'TEST123456' });
  await deliverOutbox(ctx, b.deps.senders, deps);
  assert.match(mail.sent.at(-1).body.text, /Numéro de suivi : TEST123456/);
});

test('U09 sauvegardes dans STUDIO : liste des copies vérifiées, téléchargement sous Face ID et journalisé, copie relisible par la seule clé privée', async () => {
  const b = await signedIn();
  assert.deepEqual((await b.call('GET', '/api/admin/backups')).body, { configured: false, backups: [] }, 'rien d’affiché tant que non configuré');
  const keys = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const kv = createKV();
  Object.assign(b.env, { BACKUPS: kv, BACKUP_PUBLIC_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', keys.publicKey)) });
  await b.inventory({ [SKU.S]: 2, [SKU.M]: 2, [SKU.L]: 2 });
  const backupHealth = async () => (await b.call('GET', '/api/admin/health')).body.checks.find((c) => c.name === 'Sauvegardes');
  assert.equal((await backupHealth()).state, 'wait', 'configurées, première copie attendue');
  const { ctx, deps } = b.context();
  const date = await maybeDailyBackup(ctx, deps);
  assert.ok(date);
  assert.deepEqual(await backupHealth(), { name: 'Sauvegardes', state: 'ok', detail: `Dernière copie vérifiée : ${date} ; 1 copie(s) conservée(s)` });
  const list = (await b.call('GET', '/api/admin/backups')).body;
  assert.equal(list.configured, true);
  assert.deepEqual(list.backups.map((x) => [x.name, x.checks]), [[`daily/${date}`, 'ok']]);
  assert.ok(list.backups[0].rows > 0 && list.backups[0].bytes > 0);
  const name = `daily/${date}`;
  b.clock.t += 400; // la confirmation Face ID de l'inventaire a expiré
  assert.equal((await b.call('POST', '/api/admin/backups/download', { name })).body.error, 'stepup_required', 'Face ID exigé');
  assert.equal((await b.sensitive('POST', '/api/admin/backups/download', { name: '../settings' })).body.error, 'invalid_request');
  assert.equal((await b.sensitive('POST', '/api/admin/backups/download', { name: 'daily/2020-01-01' })).status, 404);
  const got = await b.sensitive('POST', '/api/admin/backups/download', { name });
  assert.equal(got.status, 200);
  assert.equal(got.body.filename, `sayless-sauvegarde-daily-${date}.json`);
  assert.equal(got.body.content, await kv.get(name), 'copie remise telle quelle, toujours chiffrée');
  assert.ok(!got.body.content.includes('ZH-PINK'), 'aucune donnée lisible sans la clé privée');
  const dump = await openBackup(got.body.content, await crypto.subtle.exportKey('jwk', keys.privateKey));
  assert.ok(dump.tables.inventory.length === 3);
  const audit = (await b.call('GET', '/api/admin/audit')).body.entries.filter((e) => e.action === 'backup_downloaded');
  assert.deepEqual(audit.map((e) => e.target), [name]);
  b.clock.t += 37 * 3600; // aucune copie depuis : la santé du site alerte
  await b.login(b.auth);
  assert.equal((await backupHealth()).state, 'alert');
});

test('U10 V13-B1 e-mail d’expédition : intention écrite avec l’événement « expédiée » ; panne de file réparée, une seule fois ; santé du site en alerte entre-temps', async () => {
  const b = await signedIn();
  const mail = fakeMail();
  Object.assign(b.env, { RESEND_API_KEY: 're_test_uniquement', EMAIL_FROM: 'SAYLESS <commandes@example.invalid>' });
  b.deps.senders = { email: resendSender(b.env, mail.transport) };
  await b.inventory({ [SKU.S]: 2, [SKU.M]: 2, [SKU.L]: 2 });
  await b.buy(SKU.M, '10.150.0.1');
  const id = (await b.call('GET', '/api/admin/orders')).body.orders[0].id;
  await b.real.prepare("CREATE TRIGGER fixture_mail_failure BEFORE INSERT ON outbox WHEN NEW.channel = 'email' BEGIN SELECT RAISE(ABORT, 'fixture_network_failure'); END").run();
  const shipped = await b.call('POST', `/api/admin/orders/${id}/fulfil`, { step: 'shipped', carrier: 'Transporteur test', tracking: 'TEST654321' });
  assert.equal(shipped.status, 200, 'expédition enregistrée malgré la panne de file');
  assert.deepEqual(await b.real.prepare('SELECT kind, attempts FROM mail_intents WHERE dedupe = ?').bind(`shipped:${id}`).first(), { kind: 'order_shipped', attempts: 1 });
  b.clock.t += 700;
  await b.login(b.auth);
  const health = (await b.call('GET', '/api/admin/health')).body.checks.find((c) => c.name === 'File d’envoi');
  assert.equal(health.state, 'alert');
  assert.match(health.detail, /1 e-mail\(s\) client à mettre en file/);
  await b.real.prepare('DROP TRIGGER fixture_mail_failure').run();
  const { ctx, deps } = b.context();
  const { runScheduled } = await import('../../backend/src/routes.mjs');
  await runScheduled(b.env, { deps: b.deps });
  assert.equal((await b.call('POST', `/api/admin/orders/${id}/fulfil`, { step: 'shipped', carrier: 'Transporteur test', tracking: 'TEST654321' })).status, 200, 'second clic sans effet');
  await deliverOutbox(ctx, b.deps.senders, deps);
  const sent = mail.sent.filter((m) => /TEST654321/.test(m.body.text));
  assert.deepEqual([sent.length, sent[0]?.body.to], [1, [PII.email]]);
});

test('U11 ventes 1.0 relues par lots : chaque appel de STUDIO sous 50 requêtes D1 et 50 appels externes, reprise exacte, rien compté deux fois', async () => {
  const b = await signedIn({ mode: 'paused' });
  await b.sensitive('POST', '/api/admin/settings', { legacy_payment_link_id: 'plink_testlien01', legacy_link_price_id: 'price_testlien01' });
  let stripeCalls = 0;
  for (const m of ['listLinkSessions', 'retrieveSession']) {
    const original = b.stripe[m].bind(b.stripe);
    b.stripe[m] = (...a) => { stripeCalls += 1; return original(...a); };
  }
  const sell = (size, opts = {}) => b.stripe.linkSession(size, 7500, PII, { link: 'plink_testlien01', price: 'price_testlien01', ...opts });
  for (let i = 0; i < 12; i += 1) { // deux jours avant l'inventaire : historique, sans effet sur le stock
    const sid = sell(['s', 'm', 'l'][i % 3], { settledAt: b.clock.now() - 2 * 86400 });
    b.stripe.sessions.get(sid).created = b.clock.now() - 2 * 86400;
  }
  await b.inventory({ [SKU.S]: 2, [SKU.M]: 2, [SKU.L]: 2 });
  b.clock.t += 400;
  for (const size of ['s', 'm', 'l', 's', 'm', 'l']) sell(size); // après l'inventaire : les 6 pièces, alertes de fin de stock
  sell('xl');
  sell('xxl');
  sell('m', { price: 'price_inconnu' }); // à vérifier
  // Comme STUDIO : relance automatique tant que la réponse indique où reprendre.
  const syncAll = async () => {
    await b.stepUp(b.auth);
    const total = { checked: 0, recorded: 0, duplicates: 0, calls: 0 };
    let after = null;
    do {
      const [q0, s0] = [b.db.state.queries, stripeCalls];
      const r = await b.call('POST', '/api/admin/legacy/sync', after ? { after } : {});
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.ok(b.db.state.queries - q0 <= 50, `lot ${total.calls} : ${b.db.state.queries - q0} requêtes D1`);
      assert.ok(stripeCalls - s0 <= 50, `lot ${total.calls} : ${stripeCalls - s0} appels Stripe`);
      for (const k of ['checked', 'recorded', 'duplicates']) total[k] += r.body[k];
      total.calls += 1;
      after = r.body.next;
    } while (after && total.calls < 25);
    assert.equal(after, null, 'lecture terminée');
    return total;
  };
  const first = await syncAll();
  assert.ok(first.calls > 1, 'lecture répartie sur plusieurs appels');
  assert.deepEqual([first.checked, first.recorded, first.duplicates], [21, 21, 0]);
  assert.deepEqual(await b.rows(`SELECT status, review_reason, COUNT(*) AS n FROM orders WHERE source = 'legacy_link'
    GROUP BY status, review_reason ORDER BY status, review_reason`), [{ status: 'paid', review_reason: null, n: 18 },
    { status: 'paid_no_stock', review_reason: 'price', n: 1 }, { status: 'review', review_reason: 'size', n: 2 }],
  '12 ventes historiques et 6 après l’inventaire ; tailles inconnues à vérifier ; prix inconnu sans pièce libre : décision du fondateur');
  assert.deepEqual(await b.rows('SELECT sku, on_hand, reserved FROM inventory ORDER BY sku'),
    [{ sku: SKU.L, on_hand: 0, reserved: 0 }, { sku: SKU.M, on_hand: 0, reserved: 0 }, { sku: SKU.S, on_hand: 0, reserved: 0 }],
    'les 6 pièces vendues après l’inventaire sont sorties une fois');
  assert.ok(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'drop_sold_out'"), 'fin du drop signalée');
  const again = await syncAll();
  assert.deepEqual([again.checked, again.recorded, again.duplicates], [21, 0, 21], 'relire ne compte rien deux fois');
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE source = 'legacy_link'"), 21);
});
