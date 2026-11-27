// V14-R1 : critère de correction proposé à Claude. Échec connu, non masqué.
// Resend simulé avec sa fenêtre d'idempotence documentée de 24 heures ; aucun e-mail réel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bench, event, startDatabases, stopDatabases } from '../backend/helpers.mjs';
import { deliverOutbox } from '../../backend/src/notify.mjs';
import { resendSender } from '../../backend/src/email.mjs';
before(startDatabases); after(stopDatabases);
test('V14-R1 : réponse Resend perdue puis reprise à plus de 24 h, ne pas réexpédier sans rapprochement', async () => {
  const b = await bench({ 'TEST-M': 2 }); b.env.RESEND_API_KEY='fixture-only'; b.env.EMAIL_FROM='fixture@example.invalid';
  const c=await b.checkout('TEST-M'); b.stripe.pay(c.sid); await b.webhook(event('checkout.session.completed',c.sid));
  const seen=new Map(); let deliveries=0, lose=true;
  const email=resendSender(b.env,async (_,init)=>{
    const key=init.headers['Idempotency-Key']; const first=seen.get(key);
    if(first===undefined || b.clock.t-first>=86400){seen.set(key,b.clock.t);deliveries++;}
    if(lose)throw new Error('réponse perdue après acceptation du fournisseur simulé');
    return new Response('{"id":"fixture-id"}',{status:200});
  });
  const row=await b.real.prepare("SELECT dedupe FROM outbox WHERE channel='email'").first();
  await deliverOutbox({...b.env,db:b.db},{email},b.deps,{only:row.dedupe});
  assert.equal(deliveries,1); lose=false; b.clock.t+=86401;
  await deliverOutbox({...b.env,db:b.db},{email},b.deps,{only:row.dedupe});
  assert.equal(deliveries,1,'au-delà de la fenêtre Resend, conserver un état incertain à rapprocher plutôt que renvoyer');
});
