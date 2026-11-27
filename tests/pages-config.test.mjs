import { test } from 'node:test'; import assert from 'node:assert/strict';
import { pagesTestConfig } from '../scripts/prepare-pages-test.mjs';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { spawnSync } from 'node:child_process';
const state = { account_id:'a'.repeat(32), database_id:'11111111-1111-1111-1111-111111111111', url:'https://sayless-ops-test.fixture.workers.dev' };
test('Pages TEST : configuration limitée à la base de test, sans recopier de secret ni de réglage libre',async()=>{
 const c=pagesTestConfig({...state,settings:{ENVIRONMENT:'production'},APP_SECRET:'must-never-export'});
 assert.equal(c.name,'sayless-boutique-test'); assert.equal(c.vars.ENVIRONMENT,'staging'); assert.equal(c.d1_databases[0].database_name,'sayless-test');
 assert.ok(!JSON.stringify(c).includes('must-never-export')); assert.ok(!('routes' in c));
 const root=await mkdtemp(join(tmpdir(),'sayless-pages-'));
 try {
  await mkdir(join(root,'scripts')); await mkdir(join(root,'ops'));
  await copyFile(new URL('../scripts/prepare-pages-test.mjs',import.meta.url),join(root,'scripts/prepare-pages-test.mjs'));
  await writeFile(join(root,'ops/test-env.local.json'),JSON.stringify(state));
  const run=()=>spawnSync(process.execPath,[join(root,'scripts/prepare-pages-test.mjs')],{encoding:'utf8'});
  assert.equal(run().status,0); assert.deepEqual(JSON.parse(await readFile(join(root,'wrangler.json'),'utf8')),c);
  assert.equal(run().status,0,'relance locale identique autorisée');
  await writeFile(join(root,'wrangler.json'),'{}');
  assert.notEqual(run().status,0,'configuration étrangère non écrasée');
  assert.equal(await readFile(join(root,'wrangler.json'),'utf8'),'{}');
 } finally { await rm(root,{recursive:true,force:true}); }
});
test('Pages TEST : état incomplet ou origine de production refusé',()=>{
 for(const s of [{},{...state,url:'https://studio.saylessbrand.fr'},{...state,account_id:'invalid'},{...state,database_id:''},{...state,database_id:'-'.repeat(36)}]) assert.throws(()=>pagesTestConfig(s));
});
