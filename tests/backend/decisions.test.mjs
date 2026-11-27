// Décisions du fondateur du 24 novembre 2026 : zones livrées, coordonnées saisies sur Stripe avec
// livraison et point relais choisis sur SAYLESS, stock public minimisé, conservation, sauvegardes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { backupStore, bench, emptyDatabase, event, PII, startDatabases, stopDatabases } from './helpers.mjs';
import { publicStock } from '../../backend/src/stock.mjs';
import { applyRetention } from '../../backend/src/retention.mjs';
import { buyLabel, trackingUpdate, viewContact } from '../../backend/src/operations.mjs';
import { dumpDatabase, listBackups, maybeDailyBackup, openBackup, restoreDatabase, sealBackup } from '../../backend/src/backup.mjs';
import { sessionParams } from '../../backend/src/stripe.mjs';

before(startDatabases);
after(stopDatabases);
const run = async (b, fn) => { const { ctx, deps } = b.context(); return fn(ctx, deps); };
const DAY = 86400;
const rsa = () => crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
const jwk = async (pair) => ({ pub: await crypto.subtle.exportKey('jwk', pair.publicKey), priv: await crypto.subtle.exportKey('jwk', pair.privateKey) });

test('D01 zones : métropole acceptée ; Corse, outre-mer, Monaco et relais corse refusés avant paiement', async () => {
  const b = await bench({ 'TEST-M': 3 });
  const item = [{ sku: 'TEST-M', quantity: 1 }];
  const codes = [];
  for (const [opts, label] of [[{ postcode: '75011' }, 'Paris'], [{ postcode: '20000' }, 'Corse'], [{ postcode: '97400' }, 'Réunion'],
    [{ postcode: '98000', country: 'MC' }, 'Monaco'], [{ postcode: null }, 'sans code postal'],
    [{ shipping: 'relay', relay_id: 'TEST-RELAY-CORSE' }, 'relais corse'], [{ shipping: 'relay', relay_id: 'TEST-RELAY-1' }, 'relais Paris']]) {
    const r = await b.quote(item, opts);
    codes.push(`${label}:${r.status}${r.body.error ? `:${r.body.error}` : ''}`);
  }
  assert.deepEqual(codes, ['Paris:200', 'Corse:422:destination_not_supported', 'Réunion:422:destination_not_supported',
    'Monaco:422:destination_not_supported', 'sans code postal:422:postcode_required', 'relais corse:422:destination_not_supported', 'relais Paris:200']);
});

test('D02 livraison et point relais choisis sur SAYLESS ; Stripe n’affiche qu’une option, au montant exact du récapitulatif', async () => {
  const b = await bench({ 'TEST-M': 2 });
  const quote = await b.quote([{ sku: 'TEST-M', quantity: 1 }], { shipping: 'relay', relay_id: 'TEST-RELAY-1' });
  assert.deepEqual([quote.body.total_cents, quote.body.shipping_cents, quote.body.relay.id], [7990, 490, 'TEST-RELAY-1']);
  const r = await b.checkout('TEST-M', '10.70.0.1', { quote, shipping: 'relay', relay_id: 'TEST-RELAY-1' });
  const session = b.stripe.sessions.get(r.sid);
  assert.equal(session.amount_total, quote.body.total_cents);
  const keys = Object.keys(session.params);
  assert.equal(keys.filter((k) => /^shipping_options\[\d+\]\[shipping_rate_data\]\[type\]$/.test(k)).length, 1, 'une seule option de livraison');
  assert.ok(!keys.some((k) => k.startsWith('shipping_address_collection')), 'pas d’adresse demandée pour un relais');
  assert.equal(session.params['custom_fields[0][key]'], 'recipient_name');
  assert.equal(session.params['payment_method_types[0]'], 'card');
  assert.ok(!keys.some((k) => k.startsWith('payment_method_types[1]')), 'aucun autre moyen de paiement (pas de Klarna)');
  b.stripe.pay(r.sid, { customer: { ...PII, name: 'Destinataire Test' } });
  await b.webhook(event('checkout.session.completed', r.sid));
  const oid = await b.count('SELECT id FROM orders');
  const contact = await run(b, (ctx, deps) => viewContact(ctx, oid, 'fondateur', deps));
  assert.equal(contact.recipient_name, 'Destinataire Test');
  const home = sessionParams({ id: 'o', reference: 'SL-TEST-TEST', stripe_expires_at: 1, shipping_cents: 850, shipping_method: 'home' }, [], 'https://boutique.test');
  assert.ok(home.some(([k, v]) => k === 'custom_text[shipping_address][message]' && v.includes('hors Corse')));
});

test('D03 adresse saisie sur Stripe hors zone : commande « à vérifier », alerte, pas d’étiquette ni de remboursement automatique', async () => {
  const b = await bench({ 'TEST-M': 2 });
  const r = await b.checkout('TEST-M', '10.71.0.1');
  b.stripe.pay(r.sid, { customer: { ...PII, address: { ...PII.address, postal_code: '20090', city: 'Ajaccio' } } });
  await b.webhook(event('checkout.session.completed', r.sid));
  const oid = await b.count('SELECT id FROM orders');
  assert.equal(await b.count('SELECT status FROM orders'), 'review');
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'address_out_of_zone' AND level = 'critical'"), 1);
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'order_paid'"), 0);
  assert.deepEqual(await b.inv('TEST-M'), [1, 0], 'la pièce reste attribuée à cette commande');
  assert.equal((await run(b, (ctx, deps) => buyLabel(ctx, oid, b.carrier, 'studio', deps))).result, 'order_not_payable');
  assert.equal(await b.count('SELECT COUNT(*) FROM refunds'), 0);
});

test('D04 stock public minimisé : états et quantité commandable seulement, total du drop exact, sécurité inchangée', async () => {
  const b = await bench({ 'TEST-S': 9, 'TEST-M': 1, 'TEST-L': 0 });
  await b.checkout('TEST-M', '10.72.0.1');
  const stock = await publicStock(b.real, 'test-001', b.clock.now());
  assert.deepEqual(stock.variants.map((v) => [v.sku, v.state, v.orderable]), [['TEST-S', 'available', 1], ['TEST-M', 'held', 0], ['TEST-L', 'sold_out', 0]]);
  assert.equal(stock.total_available, 9);
  assert.ok(!JSON.stringify(stock).includes('"on_hand"') && !JSON.stringify(stock).includes('"reserved"'));
  const r = await b.checkout('TEST-S', '10.72.0.2', { quantity: 2 });
  assert.deepEqual([r.status, r.body.error], [422, 'quantity_not_supported'], 'le serveur garde le dernier mot');
});

test('D05 conservation : archivage à 90 jours, suppression à 913 jours, noms gardés pour la comptabilité, coupée par défaut', async () => {
  const b = await bench({ 'TEST-M': 3 });
  await b.buy('TEST-M', '10.73.0.1');
  await b.buy('TEST-M', '10.73.0.2');
  const [o1, o2] = (await b.rows('SELECT id FROM orders ORDER BY number')).map((r) => r.id);
  await run(b, (ctx, deps) => buyLabel(ctx, o1, b.carrier, 'studio', deps));
  await run(b, (ctx, deps) => trackingUpdate(ctx, o1, 'delivered', deps));
  b.clock.t += 120 * DAY;
  assert.equal((await run(b, applyRetention)).archived, 0, 'rien tant que le fondateur n’a pas validé');
  await b.real.prepare("UPDATE settings SET value = '1' WHERE key = 'retention_enabled'").run();
  const first = await run(b, applyRetention);
  assert.deepEqual([first.archived, first.deleted], [2, 0]);
  assert.deepEqual(await run(b, (ctx, deps) => viewContact(ctx, o1, 'fondateur', deps)), { archived: true });
  assert.equal((await run(b, (ctx, deps) => viewContact(ctx, o1, 'fondateur', deps, { archived: true }))).email, PII.email);
  b.clock.t += 800 * DAY;
  const second = await run(b, applyRetention);
  assert.equal(second.deleted, 2);
  assert.equal(await b.count('SELECT COUNT(*) FROM order_contacts'), 0);
  assert.equal(await b.count('SELECT COUNT(*) FROM orders WHERE customer_name IS NOT NULL'), 2, 'nom conservé 10 ans pour le livre des recettes');
  assert.equal(await b.count("SELECT COUNT(*) FROM reservations WHERE client_hash <> 'anonymise'"), 0);
  const old = Math.floor(Date.now() / 1000) - 400 * DAY;
  await b.real.prepare("INSERT INTO audit_log (at, actor, action, target, result) VALUES (?, 'f', 'view_customer_contact', 'x', 'ok'), (?, 'f', 'stock_adjustment', 'x', 'ok')").bind(old, old).run();
  await run(b, applyRetention);
  assert.equal(await b.count("SELECT COUNT(*) FROM audit_log WHERE at = ? AND action = 'view_customer_contact'", old), 0, 'trace d’accès supprimée après 1 an');
  assert.equal(await b.count("SELECT COUNT(*) FROM audit_log WHERE at = ? AND action = 'stock_adjustment'", old), 1, 'journal du stock conservé');
  await assert.rejects(b.real.prepare("DELETE FROM audit_log WHERE action = 'stock_adjustment'").run(), /audit_append_only/);
  void o2;
});

test('D06 sauvegarde chiffrée : illisible sans la clé privée, inaltérable, rotation, restauration complète', async () => {
  const b = await bench({ 'TEST-S': 4, 'TEST-M': 4 });
  for (let i = 0; i < 3; i += 1) await b.buy(i % 2 ? 'TEST-S' : 'TEST-M', `10.74.0.${i}`);
  const keys = await jwk(await rsa());
  const other = await jwk(await rsa());
  const sealed = await sealBackup(await dumpDatabase(b.real), keys.pub, b.clock.now());
  assert.ok(!sealed.includes('Client Test') && !sealed.includes('TEST-S'), 'rien de lisible dans la copie');
  await assert.rejects(openBackup(sealed, other.priv));
  const box = JSON.parse(sealed);
  await assert.rejects(openBackup(JSON.stringify({ ...box, data: box.data.slice(0, -4) + (box.data.endsWith('A') ? 'BBBB' : 'AAAA') }), keys.priv));
  await assert.rejects(openBackup(JSON.stringify({ ...box, created_at: 1 }), keys.priv), undefined, 'en-tête authentifié');
  const copy = await emptyDatabase();
  assert.deepEqual(await restoreDatabase(copy, await openBackup(sealed, keys.priv)), []);
  assert.deepEqual((await copy.prepare('SELECT * FROM inventory ORDER BY sku').all()).results, await b.rows('SELECT * FROM inventory ORDER BY sku'));
  // Rotation sur 40 jours : 30 copies quotidiennes et les copies mensuelles du 1er.
  const kv = await backupStore();
  b.env.BACKUPS = kv;
  b.env.BACKUP_PUBLIC_KEY = JSON.stringify(keys.pub);
  b.clock.t = Date.UTC(2027, 0, 1, 4, 5) / 1000;
  for (let i = 0; i < 40; i += 1) {
    assert.ok(await run(b, maybeDailyBackup));
    assert.equal(await run(b, maybeDailyBackup), null, 'une seule copie par jour');
    b.clock.t += DAY;
  }
  const list = await listBackups(kv);
  assert.equal(list.filter((x) => x.name.startsWith('daily/')).length, 30);
  assert.deepEqual(list.filter((x) => x.name.startsWith('monthly/')).map((x) => x.name), ['monthly/2027-01', 'monthly/2027-02']);
  const latest = await kv.get(list.filter((x) => x.name.startsWith('daily/')).sort((x, y) => x.name.localeCompare(y.name)).pop().name);
  const again = await emptyDatabase();
  assert.deepEqual(await restoreDatabase(again, await openBackup(latest, keys.priv)), []);
  assert.equal(Object.values(await again.prepare("SELECT COUNT(*) FROM orders WHERE status = 'paid'").first())[0], 3);
});
