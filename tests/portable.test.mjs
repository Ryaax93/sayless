import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
test('a standalone Node process serves the storefront and refuses every API without external services',async()=>{
 const child=spawn(process.execPath,['scripts/dev-storefront.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{PATH:process.env.PATH,PORT:'0'},stdio:['ignore','pipe','pipe']});
 try{
  const [chunk]=await once(child.stdout,'data');const base=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(base);
  const home=await fetch(base);assert.equal(home.status,200);assert.match(await home.text(),/SAYLESS/);
  for(const resource of ['/store/app.js','/store/api-client.js','/store/styles.css','/store/assets/logo.webp','/store/assets/body.ttf'])assert.equal((await fetch(base+resource)).status,200);
  for(const endpoint of ['/api/stock','/api/inventory','/api/checkout','/api/admin/claim']){const response=await fetch(base+endpoint,{method:endpoint.includes('checkout')||endpoint.includes('claim')?'POST':'GET'});assert.equal(response.status,503);assert.equal((await response.json()).error,'backend_not_connected');}
  for(const secretPath of ['/.env','/.openai/hosting.json','/server/api.mjs'])assert.equal((await fetch(base+secretPath)).status,404);
 }finally{const exited=once(child,'exit');child.kill();await exited;}
});
test('the catalogue contains approved product facts and no invented stock or measurements',async()=>{const d=JSON.parse(await readFile(new URL('../data/products.json',import.meta.url)));const p=d.products[0];assert.equal(p.price_cents,7500);assert.deepEqual(p.sizes,['S','M','L']);assert.equal(p.colors.length,1);assert.equal(p.colors[0].name,'Rose pastel');assert.equal(p.gsm,350);assert.equal(p.zip,'YKK');assert.equal(p.country_of_manufacture,null);assert.ok(!('stock' in p));assert.ok(p.variants.every(v=>!('quantity'in v)&&!('stock'in v)));});
