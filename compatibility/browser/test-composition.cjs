const {chromium}=require('playwright');
const {PNG}=require('pngjs');
const {createServer}=require('http');
const {readFileSync,writeFileSync}=require('fs');
const path=require('path');
const root=process.env.PFX_WEBROOT;
const mime={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm','.filamat':'application/octet-stream'};
const server=createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try{const bytes=readFileSync(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(bytes)}
  catch(e){res.writeHead(404);res.end(String(e))}
});
(async()=>{
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const url='http://127.0.0.1:'+server.address().port+'/index.html';
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:800,height:500},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
  await page.goto(url,{waitUntil:'load',timeout:30000});
  await page.waitForFunction(()=>window.PFX_COMPOSITION?.frames>=5||window.PFX_COMPOSITION?.errors?.length>0,{timeout:120000});
  const state=await page.evaluate(()=>window.PFX_COMPOSITION);
  const buf=await page.screenshot({path:process.env.PFX_SCREENSHOT,animations:'disabled'});
  const png=PNG.sync.read(buf);
  const color=(x,y)=>{
    const i=(y*png.width+x)*4;return [...png.data.subarray(i,i+4)]
  };
  const center=color(400,250),background=color(750,100),whitebar=color(65,27),magenta=color(100,47);
  const report={state,errors,center,background,whitebar,magenta,method:'Two separate canvases composited by browser; NOT shared GPU context',width:png.width,height:png.height};
  writeFileSync(process.env.PFX_REPORT,JSON.stringify(report,null,2)+'\n');
  await browser.close();
  server.close();
  if(errors.length||state.errors.length||!state.vello||!state.filament||state.frames<5)throw Error('Source engines did not both render: '+JSON.stringify(report));
  if(whitebar[0]<210||whitebar[1]<210||whitebar[2]<210)throw Error('Vello white overlay not visible in browser screenshot');
  if(magenta[0]<150||magenta[2]<120||magenta[1]>120)throw Error('Vello magenta paint missing in browser screenshot');
  const delta=Math.abs(center[0]-background[0])+Math.abs(center[1]-background[1])+Math.abs(center[2]-background[2]);
  if(delta<55)throw Error('Filament colored triangle not detected in browser screenshot');
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
})().catch(e=>{server.close();console.error(e);process.exitCode=1});
