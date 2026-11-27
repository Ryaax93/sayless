// Local static preview only. No database, checkout, mock stock or outbound requests.
import {createServer} from 'node:http';
import {readFile, stat, realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const portFlag=process.argv.indexOf('--port');
const port=Number(portFlag>=0?process.argv[portFlag+1]:(process.env.PORT||5173));
if(!Number.isInteger(port)||port<0||port>65535) throw new Error('Invalid local preview port');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
const server=createServer(async(req,res)=>{
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
 try {
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')) {res.writeHead(503,{...headers,'Content-Type':'application/json'});res.end(JSON.stringify({error:'backend_not_connected'}));return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,headers);res.end();return;}
  const pathname=decodeURIComponent(url.pathname);
  if(path.posix.normalize(pathname)==='/store/admin.js'||pathname.split('/').some(x=>x.startsWith('.')||x.includes('\\')||x.includes('\0'))){res.writeHead(404,headers);res.end();return;}
  let candidate=path.resolve(root,'.'+(['/','/merci','/commande-annulee','/suivi'].includes(pathname)?'/store/index.html':pathname));
  if(!candidate.startsWith(root)){res.writeHead(404,headers);res.end();return;}
  candidate=await realpath(candidate);
  if(!candidate.startsWith(root)||!(await stat(candidate)).isFile()){res.writeHead(404,headers);res.end();return;}
  const body=await readFile(candidate);res.writeHead(200,{...headers,'Content-Type':types[path.extname(candidate)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:body);
 }catch{res.writeHead(404,headers);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`SAYLESS local storefront: http://127.0.0.1:${server.address().port}/ (payments disabled)`));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit(0)));
