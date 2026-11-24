import {AppError,stmt,nowSeconds,DECLARATION,getInventory,initializeInventory,adjustStock,restockReturn,getOrder} from './inventory.mjs';
import {stripeReady,StripeTestClient,startTestCheckout,handleStripeWebhook,reconcileOrder} from './stripe.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','Vary':'oai-authenticated-user-id'}});
export function sameOrigin(request){const origin=request.headers.get('Origin');if(origin!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')throw new AppError('invalid_origin',403);if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new AppError('json_required',415);}
async function readJson(request){const raw=await request.text();if(raw.length>16384)throw new AppError('request_too_large',413);try{return JSON.parse(raw);}catch{throw new AppError('invalid_json');}}
async function adminStatus(request,env){
 const userId=request.headers.get('oai-authenticated-user-id');if(!userId)return {authenticated:false,authorized:false,canClaim:false};
 const principal=await stmt(env.DB,'SELECT user_id FROM admins WHERE slot=1').first();
 if(principal)return {authenticated:true,authorized:principal.user_id===userId,canClaim:false,userId};
 const email=request.headers.get('oai-authenticated-user-email');
 return {authenticated:true,authorized:false,canClaim:Boolean(env.ADMIN_BOOTSTRAP_EMAIL&&email&&email.toLowerCase()===env.ADMIN_BOOTSTRAP_EMAIL.toLowerCase()),userId};
}
export async function handleRequest(request,env){
 const path=new URL(request.url).pathname;try{
  if(!env.DB)throw new AppError('inventory_unavailable',503);
  if(path==='/api/inventory'&&request.method==='GET')return json(await getInventory(env.DB));
  if(path==='/api/stripe/webhook'&&request.method==='POST'){
   if(Number(request.headers.get('Content-Length')||0)>262144)throw new AppError('request_too_large',413);
   return json(await handleStripeWebhook(env.DB,await request.text(),request.headers.get('Stripe-Signature'),env));
  }
  // Real checkout is deliberately unavailable in this release, including with a live key.
  if(path==='/api/checkout')throw new AppError('real_payments_disabled',403);
  if(!path.startsWith('/api/admin/'))throw new AppError('not_found',404);
  const auth=await adminStatus(request,env);
  if(path==='/api/admin/status'&&request.method==='GET')return json({authenticated:auth.authenticated,authorized:auth.authorized,canClaim:auth.canClaim,stripeTestReady:stripeReady(env),livePayments:false,webhookDelivery:'not_connected',declared:DECLARATION});
  if(request.method==='POST')sameOrigin(request);
  if(path==='/api/admin/claim'&&request.method==='POST'){
   if(!auth.canClaim&&!auth.authorized)throw new AppError('admin_forbidden',403);
   await stmt(env.DB,'INSERT OR IGNORE INTO admins(slot,user_id,created_at) VALUES(1,?,?)',auth.userId,nowSeconds()).run();
   const final=await adminStatus(request,env);if(!final.authorized)throw new AppError('admin_forbidden',403);return json({authorized:true});
  }
  if(!auth.authorized)throw new AppError('admin_forbidden',403);
  if(path==='/api/admin/inventory'&&request.method==='GET')return json({real:await getInventory(env.DB,'real'),test:await getInventory(env.DB,'test'),operations:(await stmt(env.DB,'SELECT id,reason,details,created_at FROM operations ORDER BY created_at DESC LIMIT 40').all()).results,orders:(await stmt(env.DB,'SELECT id,scope,status,amount_cents,shipping_cents,refund_cents,created_at,expires_at,session_id FROM orders ORDER BY created_at DESC LIMIT 40').all()).results});
  if(path==='/api/admin/order'&&request.method==='GET')return json(await getOrder(env.DB,new URL(request.url).searchParams.get('id')));
  const body=request.method==='POST'?await readJson(request):null;
  if(path==='/api/admin/initialize'&&body)return json(await initializeInventory(env.DB,body.scope,body.variants,auth.userId,body.requestKey));
  if(path==='/api/admin/adjust'&&body)return json(await adjustStock(env.DB,body,auth.userId));
  if(path==='/api/admin/return'&&body)return json(await restockReturn(env.DB,body,auth.userId));
  if(path==='/api/admin/test-checkout'&&body){const client=new StripeTestClient(env);return json(await startTestCheckout(env.DB,body,client,new URL(request.url).origin));}
  if(path==='/api/admin/reconcile'&&body)return json(await reconcileOrder(env.DB,body.orderId,new StripeTestClient(env),body.cancel===true));
  throw new AppError('not_found',404);
 }catch(e){return json({status:'unavailable',error:e instanceof AppError?e.code:'service_unavailable'},e instanceof AppError?e.status:503);}
}
