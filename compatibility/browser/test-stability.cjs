'use strict';
// Experimental browser durability evidence, not a hardware GPU benchmark.
const {chromium}=require('playwright');
const {PNG}=require('pngjs');
const {createServer}=require('node:http');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const path=require('node:path');
if(!process.env.PFX_WEBROOT||!process.env.PFX_PROOF_DIR)throw Error('Missing webroot/proof directory');
const root=path.resolve(process.env.PFX_WEBROOT);
const dir=path.resolve(process.env.PFX_PROOF_DIR);
mkdirSync(dir,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm','.filamat':'application/octet-stream'};
const server=createServer((req,res)=>{
  let file;
  try{file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}
  catch{res.writeHead(400);return res.end();}
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try{res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(file));}
  catch(error){res.writeHead(404);res.end(String(error));}
});
const stats=s=>{
  if(!s.length)return null;
  const a=[...s].sort((x,y)=>x-y),at=p=>a[Math.ceil(a.length*p)-1];
  return {count:a.length,mean:+(s.reduce((x,y)=>x+y,0)/s.length).toFixed(3),p50:at(.5),p95:at(.95),p99:at(.99),max:a.at(-1)};
};
const rgba=(png,x,y,dpr)=>[...png.data.subarray(((y*dpr)*png.width+x*dpr)*4,((y*dpr)*png.width+x*dpr)*4+4)];
function changed(a,b,dpr){
  let n=0;
  for(let y=145;y<390;y+=4)for(let x=275;x<555;x+=4){
    const p=rgba(a,x,y,dpr),q=rgba(b,x,y,dpr);
    if(Math.abs(p[0]-q[0])+Math.abs(p[1]-q[1])+Math.abs(p[2]-q[2])>60)n++;
  }
  return n;
}
async function memory(client){
  const values=(await client.send('Performance.getMetrics')).metrics;
  const m=Object.fromEntries(values.map(x=>[x.name,x.value]));
  return {jsHeapUsedBytes:m.JSHeapUsedSize??null,jsHeapTotalBytes:m.JSHeapTotalSize??null,domNodes:m.Nodes??null};
}
async function scenario(browser,origin,spec){
  const context=await browser.newContext({viewport:{width:800,height:500},deviceScaleFactor:spec.dpr});
  const page=await context.newPage();
  const errors=[],external=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url());});
  await page.route('**/*',route=>{
    const url=route.request().url();
    if(/^https?:/.test(url)&&new URL(url).origin!==origin){external.push(url);return route.abort();}
    return route.continue();
  });
  let report=null;
  try{
    const cdp=await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const query=new URLSearchParams({stressFrames:String(spec.frames),overlay:spec.overlay});
    const start=Date.now();
    await page.goto(origin+'/index.html?'+query,{waitUntil:'load',timeout:30000});
    await page.waitForFunction(()=>window.PFX_COMPOSITION?.frames>=40||window.PFX_COMPOSITION?.errors?.length>0,null,{timeout:120000});
    const mid=PNG.sync.read(await page.screenshot({animations:'disabled'}));
    const warm=await memory(cdp);
    await page.waitForFunction(frames=>window.PFX_COMPOSITION?.frames>=frames||window.PFX_COMPOSITION?.errors?.length>0,spec.frames,{timeout:120000});
    const state=await page.evaluate(()=>window.PFX_COMPOSITION);
    const end=await memory(cdp);
    const final=PNG.sync.read(await page.screenshot({path:path.join(dir,spec.name+'.png'),animations:'disabled'}));
    const pixels={white:rgba(final,65,27,spec.dpr),magenta:rgba(final,100,47,spec.dpr)};
    report={
      scenario:spec.name,status:'PASS',dpr:spec.dpr,overlayVisible:spec.overlay==='shown',
      width:final.width,height:final.height,framesRequested:spec.frames,framesCompleted:state.frames,
      wallMs:Date.now()-start,
      rendererCpuCallMs:stats(state.renderDurationsMs.slice(30)),
      callbackIntervalMs:stats(state.frameIntervalsMs.slice(30)),
      velloRasterCpuMs:state.velloRenderMs,velloCanvasUploadCallMs:state.velloUploadMs,
      filamentInitMs:state.filamentInitMs,gpuVersion:state.gpuVersion,
      moving3dChangedSamples:changed(mid,final,spec.dpr),
      originalTransparentAlpha:state.pixelChecks?.transparent,contextLosses:state.contextLosses,
      memory:{warm,end,jsHeapDeltaBytes:warm.jsHeapUsedBytes===null||end.jsHeapUsedBytes===null?null:end.jsHeapUsedBytes-warm.jsHeapUsedBytes},
      errors:[...errors,...state.errors],externalNetworkRequests:external,
      note:'SwiftShader software GL; CPU render submission not GPU completion. CDP JS heap excludes WASM linear memory, GPU resources and browser process memory.'
    };
    const failures=[];
    if(report.errors.length)failures.push('Console/runtime error');
    if(external.length)failures.push('Off-origin request');
    if(!state.vello||!state.filament||!state.perspective)failures.push('Engine not running');
    if(state.frames<spec.frames||state.targetFrames!==spec.frames)failures.push('Incomplete animation');
    if(state.contextLosses!==0)failures.push('Unexpected GL context loss');
    if(final.width!==800*spec.dpr||final.height!==500*spec.dpr)failures.push('Screenshot size');
    if(state.pixelChecks?.transparent!==0)failures.push('Incorrect alpha');
    if(report.moving3dChangedSamples<150)failures.push('3D animation not visible');
    if(spec.overlay==='shown'&&(pixels.white.slice(0,3).some(v=>v<210)||pixels.magenta[0]<150||pixels.magenta[2]<120||pixels.magenta[1]>120))failures.push('2D foreground missing');
    if(!report.rendererCpuCallMs||!report.callbackIntervalMs)failures.push('No frame measurements');
    if(failures.length){report.status='FAIL';report.failures=failures;}
    writeFileSync(path.join(dir,spec.name+'.json'),JSON.stringify(report,null,2)+'\n');
    if(failures.length)throw Error(spec.name+': '+failures.join('; '));
    return report;
  }catch(err){
    writeFileSync(path.join(dir,spec.name+'-error.json'),JSON.stringify({message:String(err),report,errors,external},null,2)+'\n');
    throw err;
  }finally{await context.close();}
}
(async()=>{
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const cases=[
    {name:'dpr1-overlay-420',dpr:1,frames:420,overlay:'shown'},
    {name:'dpr2-overlay-300',dpr:2,frames:300,overlay:'shown'},
    {name:'dpr1-hidden-300',dpr:1,frames:300,overlay:'hidden'},
    {name:'dpr1-recreated-180',dpr:1,frames:180,overlay:'shown'}
  ];
  try{
    const reports=[];
    for(const spec of cases){
      reports.push(await scenario(browser,origin,spec));
      process.stdout.write('PASS '+spec.name+'\n');
    }
    const result={status:'PASS',testedAt:new Date().toISOString(),reports,
      method:'4 sequential freshly-created browser contexts, 1200 animated frames; source-built artifacts replayed from a pinned successful run.',
      limitations:'Observational measurements on shared, software-rendered CI. No GPU time, complete memory footprint or causal compositor overhead inferred.'};
    writeFileSync(path.join(dir,'stress-summary.json'),JSON.stringify(result,null,2)+'\n');
    process.stdout.write(JSON.stringify(reports.map(r=>({scenario:r.scenario,renderP95:r.rendererCpuCallMs.p95,callbackP95:r.callbackIntervalMs.p95,jsHeapDeltaBytes:r.memory.jsHeapDeltaBytes})))+'\n');
  }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(()=>server.close());
