'use strict';
// Comparison of actual engine-isolated workloads. Observational SwiftShader measurements.
const {chromium}=require('playwright');
const {PNG}=require('pngjs');
const {createServer}=require('node:http');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
if(!process.env.PFX_WEBROOT||!process.env.PFX_PROOF_DIR)throw Error('Missing webroot/proof paths');
const root=path.resolve(process.env.PFX_WEBROOT),out=path.resolve(process.env.PFX_PROOF_DIR);
mkdirSync(out,{recursive:true});
const types={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm','.filamat':'application/octet-stream'};
const server=createServer((req,res)=>{
  let file;
  try{file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}
  catch{res.writeHead(400);return res.end();}
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try{res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(file));}
  catch(e){res.writeHead(404);res.end(String(e));}
});
const metric=a=>{
  if(!a.length)return null;
  const sorted=[...a].sort((x,y)=>x-y),p=x=>sorted[Math.ceil(sorted.length*x)-1];
  return {count:a.length,mean:+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(3),p50:p(.5),p95:p(.95),p99:p(.99),max:sorted.at(-1)};
};
const median=a=>metric(a)?.p50??null;
const rgba=(png,x,y)=>[...png.data.subarray((y*png.width+x)*4,(y*png.width+x)*4+4)];
function motionPixels(first,last){
  let changed=0;
  for(let y=145;y<390;y+=4)for(let x=275;x<555;x+=4){
    const p=rgba(first,x,y),q=rgba(last,x,y);
    if(Math.abs(p[0]-q[0])+Math.abs(p[1]-q[1])+Math.abs(p[2]-q[2])>60)changed++;
  }
  return changed;
}
async function jsMemory(client){
  const m=Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  return {usedBytes:m.JSHeapUsedSize??null,totalBytes:m.JSHeapTotalSize??null,domNodes:m.Nodes??null};
}
function browserTreeRssKB(pid){
  if(!pid)return null;
  try{
    const all=execFileSync('ps',['-eo','pid=,ppid=,rss='],{encoding:'utf8'}).trim().split('\n')
      .map(s=>s.trim().split(/\s+/).map(Number)).filter(a=>a.length===3&&a.every(Number.isFinite));
    const descendants=new Set([pid]);
    let changed=true;
    while(changed){
      changed=false;
      for(const [child,parent] of all)if(descendants.has(parent)&&!descendants.has(child)){
        descendants.add(child);changed=true;
      }
    }
    const active=all.filter(([id])=>descendants.has(id));
    return {pid,processes:active.length,rssSumKB:active.reduce((sum,row)=>sum+row[2],0),
      caveat:'RSS is summed across Chromium processes; shared pages are counted multiple times. This is NOT distinct physical RAM or GPU/VRAM allocation.'};
  }catch{return null;}
}
function locateBrowserPid(){
  // Playwright does not expose Browser.process(); identify this isolated CI browser
  // from the executable command line instead. Missing/ambiguous PID => null RSS.
  try{
    const rows=execFileSync('ps',['-eo','pid=,ppid=,args='],{encoding:'utf8'}).split('\n');
    const candidates=rows.filter(x=>x.includes('--remote-debugging-pipe')&&/chrome-headless-shell|chromium|chrome/.test(x));
    if(candidates.length!==1)return null;
    return Number(candidates[0].trim().split(/\s+/)[0])||null;
  }catch{return null;}
}
async function scenario(browser,origin,mode,iteration){
  const label=iteration+'-'+mode,context=await browser.newContext({viewport:{width:800,height:500},deviceScaleFactor:1});
  const page=await context.newPage(),errors=[],external=[],requested=[];
  const pid=locateBrowserPid();
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url());});
  await page.route('**/*',route=>{
    const u=route.request().url();
    requested.push(new URL(u).pathname);
    if(new URL(u).origin!==origin){external.push(u);return route.abort();}
    return route.continue();
  });
  let result=null;
  try{
    const cdp=await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const query=new URLSearchParams({mode,stressFrames:'240'});
    const since=Date.now();
    await page.goto(origin+'/compare.html?'+query,{waitUntil:'load',timeout:30000});
    await page.waitForFunction(()=>window.PFX_COMPOSITION?.frames>=40||window.PFX_COMPOSITION?.errors?.length>0||window.PFX_BOOT_ERROR,null,{timeout:90000});
    const first=PNG.sync.read(await page.screenshot({animations:'disabled'}));
    const warmHeap=await jsMemory(cdp),warmRss=browserTreeRssKB(pid);
    await page.waitForFunction(()=>window.PFX_COMPOSITION?.frames>=240||window.PFX_COMPOSITION?.errors?.length>0||window.PFX_BOOT_ERROR,null,{timeout:90000});
    const state=await page.evaluate(()=>window.PFX_COMPOSITION);
    const endHeap=await jsMemory(cdp),endRss=browserTreeRssKB(pid);
    const last=PNG.sync.read(await page.screenshot({path:path.join(out,label+'.png'),animations:'disabled'}));
    result={
      label,mode,iteration,status:'PASS',frames:state.frames,wallTo240FramesMs:Date.now()-since,
      raster2dCpuMs:state.velloRenderMs??null,canvas2dUploadCallMs:state.velloUploadMs??null,
      rgbaUploadBufferBytes:state.overlayRgbaBytes,filamentReadyMs:state.filamentInitMs??null,
      filamentRenderCpuCallMs:metric(state.renderDurationsMs.slice(40)),
      rafCallbackIntervalMs:metric(state.frameIntervalsMs.slice(40)),
      cpuRenderer:state.gpuRenderer??null,glVersion:state.gpuVersion??null,
      memory:{jsHeapAt40Frames:warmHeap,jsHeapAt240Frames:endHeap,
        jsHeapDeltaBytes:endHeap.usedBytes===null||warmHeap.usedBytes===null?null:endHeap.usedBytes-warmHeap.usedBytes,
        chromiumRssAt40Frames:warmRss,chromiumRssAt240Frames:endRss},
      pixelChecks:{white:rgba(last,65,27),magenta:rgba(last,100,47),moving3dSamples:mode==='2d'?null:motionPixels(first,last),
        alphaSource:state.pixelChecks?.transparent??null},
      network:{paths:requested,external},
      runtimeErrors:[...errors,...state.errors]
    };
    const fail=[];
    if(result.runtimeErrors.length||external.length)fail.push('Runtime or network failure');
    if(state.frames!==240||state.targetFrames!==240)fail.push('Incomplete frames');
    if(last.width!==800||last.height!==500)fail.push('Screenshot shape');
    if(!result.rafCallbackIntervalMs)fail.push('No RAF timing');
    if(mode==='2d'){
      if(!state.vello||state.filament||state.pixelChecks?.transparent!==0)fail.push('2D engine isolation failed');
      if(requested.some(p=>/filament|filamat/.test(p)))fail.push('3D runtime loaded in 2D-only run');
    }else{
      if(!state.filament||!state.perspective||!result.filamentRenderCpuCallMs||state.contextLosses!==0)fail.push('3D engine not stable');
      if(result.pixelChecks.moving3dSamples<150)fail.push('Missing 3D motion');
    }
    if(mode==='3d'){
      if(state.vello||requested.some(p=>/pfx_vello_overlay/.test(p)))fail.push('2D runtime loaded in 3D-only run');
    }else{
      if(!state.vello||state.overlayRgbaBytes!==800*500*4)fail.push('Vello not rasterized');
      const white=result.pixelChecks.white,magenta=result.pixelChecks.magenta;
      if(white.slice(0,3).some(c=>c<210)||magenta[0]<150||magenta[2]<120||magenta[1]>120)fail.push('Missing visible Vello painting');
    }
    if(fail.length){result.status='FAIL';result.failures=fail;}
    writeFileSync(path.join(out,label+'.json'),JSON.stringify(result,null,2)+'\n');
    if(fail.length)throw Error(label+': '+fail.join('; '));
    process.stdout.write('PASS '+label+' | 3D CPU call p95 '+(result.filamentRenderCpuCallMs?.p95??'n/a')+' ms; callback p95 '+result.rafCallbackIntervalMs.p95+' ms\n');
    return result;
  }catch(error){
    writeFileSync(path.join(out,label+'-failure.json'),JSON.stringify({error:String(error),result,errors,external,requested},null,2)+'\n');
    throw error;
  }finally{await context.close();}
}
(async()=>{
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    // Counterbalanced order limits (does not eliminate) runner warmup and ordering bias.
    const orders=[['2d','3d','mixed'],['mixed','2d','3d'],['3d','mixed','2d']];
    const reports=[];
    for(let round=0;round<orders.length;round++){
      for(const mode of orders[round])reports.push(await scenario(browser,origin,mode,round+1));
    }
    const aggregates={};
    for(const mode of ['2d','3d','mixed']){
      const subset=reports.filter(x=>x.mode===mode);
      aggregates[mode]={
        repetitions:subset.length,frames:subset.reduce((a,x)=>a+x.frames,0),
        medianRafCallbackP95Ms:median(subset.map(x=>x.rafCallbackIntervalMs.p95)),
        medianFilamentCpuSubmitP95Ms:median(subset.filter(x=>x.filamentRenderCpuCallMs).map(x=>x.filamentRenderCpuCallMs.p95)),
        medianJSHeapAt240FramesBytes:median(subset.map(x=>x.memory.jsHeapAt240Frames.usedBytes).filter(Number.isFinite)),
        medianChromiumRssSumAt240FramesKB:median(subset.map(x=>x.memory.chromiumRssAt240Frames?.rssSumKB).filter(Number.isFinite)),
        medianVelloRasterCpuMs:median(subset.map(x=>x.raster2dCpuMs).filter(Number.isFinite)),
        medianCanvas2dUploadCallMs:median(subset.map(x=>x.canvas2dUploadCallMs).filter(Number.isFinite))
      };
    }
    const result={
      status:'PASS',timestamp:new Date().toISOString(),runType:'source artifact replay',
      totals:{scenarios:reports.length,frames:reports.reduce((a,x)=>a+x.frames,0)},
      order:orders,aggregate:aggregates,reports,
      caveats:[
        '2D-only performs one static Vello CPU raster and one Canvas2D image upload; RAF callbacks afterward do not rerasterize.',
        '3D-only and mixed animate the same Filament cube; mixed additionally has a static 2D overlay.',
        'Results are software SwiftShader, NOT hardware GPU throughput or GPU completion times.',
        'Chromium process RSS is sum over processes and may count shared resident pages more than once. No VRAM measurement.',
        'Different scenarios run sequentially in one browser and may have temperature, GC and scheduling effects. No causal GPU compositor cost inferred.',
        'No shared GPU context: browser composites distinct 2D and WebGL2 canvases.'
      ]
    };
    writeFileSync(path.join(out,'composition-comparison.json'),JSON.stringify(result,null,2)+'\n');
    process.stdout.write('SUMMARY '+JSON.stringify({totals:result.totals,aggregate:aggregates})+'\n');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
