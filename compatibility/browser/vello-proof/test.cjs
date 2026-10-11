const {chromium}=require('playwright');
const {createServer}=require('http');
const {readFileSync,writeFileSync}=require('fs');
const path=require('path');
const root=path.resolve(process.env.PFX_WEBROOT);
const server=createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
  try{res.writeHead(200,{'Content-Type':path.extname(file)==='.wasm'?'application/wasm':path.extname(file)==='.js'?'application/javascript':'text/html'});res.end(readFileSync(file))}
  catch(e){res.writeHead(404);res.end(String(e))}
});
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:800,height:500},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html',{waitUntil:'load',timeout:30000});
  await page.waitForFunction(()=>window.PFX_PROOF?.ok||window.PFX_PROOF?.errors?.length>0,null,{timeout:60000});
  const report={result:await page.evaluate(()=>window.PFX_PROOF),browserErrors:errors};
  await page.screenshot({path:process.env.PFX_SCREENSHOT});
  writeFileSync(process.env.PFX_REPORT,JSON.stringify(report,null,2)+'\n');
  if(!report.result.ok||errors.length)throw Error('Vello browser proof failed '+JSON.stringify(report));
  process.stdout.write('PFX_VELLO_BROWSER_PASS '+JSON.stringify(report)+'\n');
 }finally{await browser.close();server.close()}
})().catch(error=>{console.error(error);process.exitCode=1;server.close()});
