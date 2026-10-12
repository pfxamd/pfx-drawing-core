'use strict';
// Command-derived invalidation / lifecycle / actual multi-rectangle repaint.
// Reference pixels are used strictly as an independent post-facto oracle.
const {chromium}=require('playwright');
const {createServer}=require('node:http');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const path=require('node:path');
const {estimateDamage,encoded,stages}=require('./operation-damage.cjs');
if(!process.env.PFX_WEBROOT||!process.env.PFX_PROOF_DIR)throw Error('Paths required');
const root=path.resolve(process.env.PFX_WEBROOT),out=path.resolve(process.env.PFX_PROOF_DIR);
mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm'};
const server=createServer((req,res)=>{
 let f;
 try{f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}
 catch{res.writeHead(400);return res.end();}
 if(!f.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 try{res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(f));}
 catch(e){res.writeHead(404);res.end(String(e));}
});
const canvases=[{w:640,h:400},{w:800,h:500},{w:1024,h:640}];
// Invalidations are computed from the same declarative DRAW COMMANDS supplied
// to the WASM renderer. No pixel diff or full-frame render enters planning.
function plansFor({w,h}){
 const plans=[];
 const causes=new Set();
 for(let i=1;i<stages.length;i++){
  const p=estimateDamage(stages[i-1],stages[i],w,h);
  p.causes.forEach(c=>causes.add(c.cause));
  plans.push(p);
 }
 for(const c of ['insert','delete','move','opacity','blend','clip','reorder'])
  if(!causes.has(c))throw Error('Missing lifecycle change: '+c);
 if(plans.at(-2).rects.length!==0)throw Error('No-change transition must not invalidate');
 if(!plans.some(p=>p.rects.length>1))throw Error('Must exercise spatially separated damage regions');
 if(!plans.some(p=>p.damagePixels<w*h*0.5&&p.damagePixels>0))
  throw Error('Estimator failed to find any genuinely partial update');
 return plans;
}
function checkInput(){
 let threw=false;
 try{estimateDamage(stages[0],[stages[0][0],stages[0][0]],800,500)}
 catch{threw=true;}
 if(!threw)throw Error('Estimator accepted duplicate IDs');
 if(encoded(stages[0]).length!==21)throw Error('Invalid operation encoding');
 return true;
}
checkInput();

function rectPieces(rect,mode){
 if(mode==='whole')return [rect];
 // Split into four overlapping but complete subrectangles. Duplicate pixels
 // are intentionally written twice to exercise ordering / re-rasterization.
 const midX=rect.x+Math.floor(rect.w/2);
 const midY=rect.y+Math.floor(rect.h/2);
 const left={x:rect.x,w:Math.min(rect.w,midX-rect.x+4)};
 const right={x:Math.max(rect.x,midX-4)};
 right.w=rect.x+rect.w-right.x;
 const top={y:rect.y,h:Math.min(rect.h,midY-rect.y+4)};
 const bottom={y:Math.max(rect.y,midY-4)};
 bottom.h=rect.y+rect.h-bottom.y;
 return [top,bottom].flatMap(y=>[left,right].map(x=>({...x,...y})));
}
async function verify(browser,origin,canvas,round){
 const context=await browser.newContext({viewport:{width:1100,height:700},deviceScaleFactor:1});
 const page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
 page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url())});
 await page.route('**/*',route=>{
  const u=route.request().url();
  if(u.startsWith('http')&&new URL(u).origin!==origin){external.push(u);return route.abort();}
  return route.continue();
 });
 const filename='r'+round+'-'+canvas.w+'x'+canvas.h;
 const plans=plansFor(canvas);
 const states=stages.map(s=>encoded(s));
 const layouts=round===1?['whole','overlap-four']:['overlap-four','whole'];
 const scheduled=plans.map(p=>({
  ...p,layouts:Object.fromEntries(layouts.map(layout=>[layout,
    p.rects.flatMap(r=>rectPieces(r,layout))]))
 }));
 let report;
 try{
  await page.goto(origin+'/aa-precision.html',{waitUntil:'load',timeout:30000});
  await page.waitForFunction(()=>window.PFX_AA!==undefined,null,{timeout:120000});
  report=await page.evaluate(({canvas,states,scheduled,layouts})=>{
   const api=window.PFX_AA;
   if(!api.ready||typeof api.operations!=='function')
    throw Error('Command renderer unavailable '+api.error);
   const {w,h}=canvas,full={x:0,y:0,w,h},logs=[];
   const raster=(state,r,canonical)=>{
    const bytes=api.operations(w,h,r.x,r.y,r.w,r.h,new Float64Array(state),canonical);
    if(bytes.length!==r.w*r.h*4)throw Error('Wrong RGBA count');
    return bytes;
   };
   const fulls=states.map(state=>raster(state,full,false));
   let fullCanonicalChanged=0,backgroundPixels=0;
   for(let i=0;i<states.length;i++){
    const alt=raster(states[i],full,true);
    for(let j=0;j<alt.length;j++)if(alt[j]!==fulls[i][j])fullCanonicalChanged++;
    for(let a=3;a<alt.length;a+=4)if(alt[a]>0)backgroundPixels++;
   }
   const differing=(reference,buffer,region,samples)=>{
    let channels=0,pixels=0,maxDelta=0;
    for(let y=region.y;y<region.y+region.h;y++){
     const offset=(y*w+region.x)*4;
     for(let x=0;x<region.w;x++){
      let hit=false;
      for(let ch=0;ch<4;ch++){
       const idx=offset+x*4+ch;
       const delta=Math.abs(reference[idx]-buffer[idx]);
       if(!delta)continue;
       hit=true;channels++;maxDelta=Math.max(maxDelta,delta);
       if(samples.length<5)samples.push({x:region.x+x,y,channel:ch,expected:reference[idx],actual:buffer[idx]});
      }
      if(hit)pixels++;
     }
    }
    return {channels,pixels,maxDelta};
   };
   const paste=(target,bytes,r)=>{
    for(let y=0;y<r.h;y++){
     const src=y*r.w*4;
     target.set(bytes.subarray(src,src+r.w*4),((r.y+y)*w+r.x)*4);
    }
   };
   const inside=(x,y,regions)=>regions.some(r=>
    x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h);
   // Every layout maintains an ACTUAL independent prior-frame byte buffer.
   // Neither buffer is reset from fulls[i] between stages.
   const caches=Object.fromEntries(layouts.map(k=>[k,new Uint8Array(fulls[0])]));
   let totalMissing=0,changedTruthPixels=0,totalLayerChannels=0,totalLegacyChannels=0;
   let changedNoOp=0,totalRenderCalls=0;
   for(let i=1;i<states.length;i++){
    const plan=scheduled[i-1],prev=fulls[i-1],next=fulls[i],samples=[];
    // Pixel truth detects missed damage AFTER planning; never feeds back
    // into the estimator or rect-generation algorithm.
    let missed=0,changed=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
     const pos=(y*w+x)*4;
     const different=prev[pos]!==next[pos]||prev[pos+1]!==next[pos+1]||
       prev[pos+2]!==next[pos+2]||prev[pos+3]!==next[pos+3];
     if(!different)continue;
     changed++;
     if(!inside(x,y,plan.rects))missed++;
    }
    totalMissing+=missed;changedTruthPixels+=changed;
    if(plan.rects.length===0&&changed>0)changedNoOp++;
    const layoutStats=[];
    for(const layout of layouts){
     const rects=plan.layouts[layout],cache=caches[layout];
     let legacy=0,canonicalDirect=0;
     for(const rect of rects){
      const fresh=raster(states[i],rect,true);
      // Independent BASELINE tile render for origin-sensitive comparison.
      const old=raster(states[i],rect,false);
      for(let y=0;y<rect.h;y++){
       const global=(rect.y+y)*w+rect.x;
       const local=y*rect.w;
       for(let x=0;x<rect.w;x++){
        for(let ch=0;ch<4;ch++){
         if(old[(local+x)*4+ch]!==next[(global+x)*4+ch])legacy++;
         if(fresh[(local+x)*4+ch]!==next[(global+x)*4+ch])canonicalDirect++;
        }
       }
      }
      paste(cache,fresh,rect);
      totalRenderCalls++;
     }
     const compare=differing(next,cache,full,samples);
     totalLegacyChannels+=legacy;
     totalLayerChannels+=canonicalDirect;
     layoutStats.push({layout,renderedTiles:rects.length,legacyChannels:legacy,
      canonicalChannels:canonicalDirect,compositedChannels:compare.channels,
      compositedPixels:compare.pixels,maxDelta:compare.maxDelta,
      rasterizedPixels:rects.reduce((sum,r)=>sum+r.w*r.h,0)});
    }
    logs.push({transition:(i-1)+'->'+i,changedTruthPixels:changed,
      commandCauses:plan.causes,dirtyRects:plan.rects,dirtyPixels:plan.damagePixels,
      wholeCanvasPixels:w*h,missedTruthPixels:missed,
      comparedLayouts:layoutStats,samples});
   }
   let noOpPixelMatch=0;
   for(let i=0;i<fulls[6].length;i++)if(fulls[6][i]!==fulls[7][i])noOpPixelMatch++;
   return {canvas,transitionCount:scheduled.length,layouts,logs,
    fullCanonicalChanged,backgroundPixels,totalMissing,changedTruthPixels,
    totalLayerChannels,totalLegacyChannels,noOpPixelMatch,changedNoOp,
    totalRenderCalls};
  },{canvas,states,scheduled,layouts});
  // Screenshot of the actual source-built WASM output, not an illustration.
  if(round===1&&canvas.w===800){
   await page.evaluate(({state})=>{
    const rgba=window.PFX_AA.operations(800,500,0,0,800,500,new Float64Array(state),true);
    const el=document.getElementById('output');
    el.width=800;el.height=500;
    el.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba),800,500),0,0);
   },{state:states[8]});
   await page.screenshot({path:path.join(out,'operations-stage8-800x500.png')});
  }
  const failures=[];
  if(report.fullCanonicalChanged!==0)failures.push('Full image changed between original and canonical modes');
  if(report.totalMissing!==0)failures.push('Operation-based damage MISSED changed pixels');
  if(report.totalLayerChannels!==0)failures.push('Canonical dirty pixels mismatched full frame');
  if(report.changedNoOp!==0||report.noOpPixelMatch!==0)failures.push('Identical scene state caused frame change');
  if(report.totalRenderCalls===0||report.changedTruthPixels<100||report.backgroundPixels<100)
   failures.push('Insufficient actual animation/painting tested');
  for(const log of report.logs){
   for(const l of log.comparedLayouts)
    if(l.compositedChannels!==0)failures.push('Persistent cache mismatch '+log.transition+' '+l.layout);
  }
  if(errors.length||external.length)failures.push('Browser request or page error');
  report.status=failures.length?'FAIL':'PASS';report.failures=failures;
  report.browserErrors=errors;report.externalRequests=external;
  writeFileSync(path.join(out,filename+'.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(report.status+' '+filename+
   ' missed='+report.totalMissing+' tileDeltas='+report.totalLayerChannels+
   ' legacy='+report.totalLegacyChannels+' cachedDeltas='+
   report.logs.reduce((n,l)=>n+l.comparedLayouts.reduce((a,c)=>a+c.compositedChannels,0),0)+'\n');
  return report;
 }catch(e){
  writeFileSync(path.join(out,filename+'-error.json'),
   JSON.stringify({error:String(e),report,errors,external},null,2)+'\n');
  process.stderr.write('ERROR '+filename+' '+String(e)+'\n');
  return {status:'FAIL',error:String(e),canvas,round};
 }finally{await context.close();}
}
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const outputs=[];
  for(let round=1;round<=2;round++){
   const sizes=round===1?canvases:[...canvases].reverse();
   for(const c of sizes)outputs.push(await verify(browser,origin,c,round));
  }
  const status=outputs.every(r=>r.status==='PASS')?'PASS':'FAIL';
  const summary={status,contexts:outputs.length,transitions:outputs.reduce((n,r)=>n+(r.transitionCount||0),0),
   changedTruthPixels:outputs.reduce((n,r)=>n+(r.changedTruthPixels||0),0),
   missedPixels:outputs.reduce((n,r)=>n+(r.totalMissing||0),0),
   canonicalTileChanges:outputs.reduce((n,r)=>n+(r.totalLayerChannels||0),0),
   legacyTileChanges:outputs.reduce((n,r)=>n+(r.totalLegacyChannels||0),0),
   actualTileRenders:outputs.reduce((n,r)=>n+(r.totalRenderCalls||0),0),
   results:outputs.map(r=>({canvas:r.canvas,round:r.round,status:r.status,failures:r.failures,
     error:r.error,transitions:r.transitionCount,missed:r.totalMissing,
     canonicalDelta:r.totalLayerChannels,legacyDelta:r.totalLegacyChannels,
     tileRenders:r.totalRenderCalls,logs:r.logs?.map(x=>({
      transition:x.transition,causes:x.commandCauses,dirtyRects:x.dirtyRects,
      dirtyPixels:x.dirtyPixels,changedTruthPixels:x.changedTruthPixels,
      missedTruthPixels:x.missedTruthPixels,layouts:x.comparedLayouts}))})),
   limitations:[
    'Damage estimator uses manually conservative semantic geometry bounds from the exact declarative draw operations; not generated from unknown third-party drawing APIs.',
    'Full-frame images are only a truth oracle AFTER operation-derived damage selection, never an input to damage planning.',
    'Only selected fill/stroke shapes and SrcOver isolated blend/opacity operations; no projectwide clip graph or GPU/3D damage propagation.',
    'Actual canonical CPU WASM rasterizes each tile and copies bytes into independent prior-frame caches; no shortcut replacing cache from full reference.',
    'Two Chromium contexts and 3 canvas sizes, no real hardware GPU or parallel multithreaded benchmarks.',
    'No main merge.'
   ]};
  writeFileSync(path.join(out,'operation-damage-summary.json'),JSON.stringify(summary,null,2)+'\n');
  process.stdout.write('SUMMARY '+status+' '+summary.transitions+' transitions missed='+summary.missedPixels+
   ' canonical='+summary.canonicalTileChanges+' copied='+summary.actualTileRenders+'\n');
  if(status!=='PASS')process.exitCode=1;
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
