// Generates local static output only. Never deploys or contacts a cloud service.
import {cp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const output=new URL('../dist-storefront/',import.meta.url);
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await cp(new URL('../public/',import.meta.url),output,{recursive:true,filter:source=>basename(source)!=='admin.js'});
await writeFile(new URL('index.html',output),await readFile(new URL('../public/store/index.html',import.meta.url)));
await cp(new URL('../data/',import.meta.url),new URL('data/',output),{recursive:true});
console.log(`Static build ready: ${fileURLToPath(output)} (no deployment)`);
