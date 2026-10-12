'use strict';
// Falsification-oriented halo sweep. Full references verify only; never
// used for damage planning or choosing expanded source regions.
const {chromium}=require('playwright');
const {createServer}=require('node:http');
const {mkdirSync,readFileSync,writeFileSync}=require('node:fs');
const path=require('node:path');
const {states,rect}=require('./boundary-effect-damage.cjs');
if(!process.env.PFX_WEBROOT||!process.env.PFX_PROOF_DIR)throw Error('Expected harness paths');
const root=path.resolve(process.env.PFX_WEBROOT),out=path.resolve(process.env.PFX_PROOF_DIR);
mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm'};
const server=createServer((req,res)=>{
 let f;try{f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}
 catch{res.writeHead(400);return res.end();}
 if(!f.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 try{res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(f))}
 catch(e){res.writeHead(404);res.end(String(e));}
});
const sizes=[{w:640,h:400},{w:800,h:500},{w:1024,h:640}];
const pads=[0,4,8,12,16,24,32,48,64,96,128];
const cases=[1,2,4,5,6,7,8,9,10,11,12];
const identityRegion=[{x:397,y:166,w:124,h:108},{x:461,y:183,w:111,h:100},
 {x:517,y:224,w:105,h:104},{x:376,y:240,w:120,h:100}];
function split(r){
 const mx=r.x+Math.floor(r.w/2),my=r.y+Math.floor(r.h/2);
 const xs=[[r.x,Math.min(r.x+r.w,mx+5)],[Math.max(r.x,mx-5),r.x+r.w]];
 const ys=[[r.y,Math.min(r.y+r.h,my+5)],[Math.max(r.y,my-5),r.y+r.h]];
 return ys.flatMap(([y0,y1])=>xs.map(([x0,x1])=>({x:x0,y:y0,w:x1-x0,h:y1-y0})));
}
function regions(canvas,i){
 // Include EXACT previously falsifying tile origins (the four-way split of
 // semantically planned previous/current bounds), alongside independent probes.
 // Recreate the EXACT unsafe pre-fallback layout from the negative proof,
 // not the post-fix full-frame invalidation. These are command-derived bounds.
 const a=rect(states[i-1],canvas.w,canvas.h),b=rect(states[i],canvas.w,canvas.h);
 const damage=a&&b?{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),
   w:Math.max(a.x+a.w,b.x+b.w)-Math.min(a.x,b.x),
   h:Math.max(a.y+a.h,b.y+b.h)-Math.min(a.y,b.y)}:a||b;
 const probe=identityRegion.map(r=>({x:r.x,y:r.y,w:Math.min(r.w,canvas.w-r.x),h:Math.min(r.h,canvas.h-r.y)}));
 const original=[];
 for(const r of damage?[damage]:[]){
  if(r.w<=0||r.h<=0)continue;
  const tiles=split(r);for(const x of tiles)if(x.w>0&&x.h>0)original.push(x);
 }
 const all=[...original,...probe].filter(r=>r.w>0&&r.h>0);
 return all.map((r,k)=>({...r,kind:k<original.length?'previous-failing-grid':'independent-probe'}));
}
function expanded(r,p,w,h){
 const x=Math.max(0,r.x-p),y=Math.max(0,r.y-p);
 const x1=Math.min(w,r.x+r.w+p),y1=Math.min(h,r.y+r.h+p);
 return {x,y,w:x1-x,h:y1-y};
}
async function examine(browser,origin,canvas,round){
 const context=await browser.newContext({viewport:{width:1150,height:700}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
 await page.route('**/*',route=>{
  const u=route.request().url();if(u.startsWith('http')&&new URL(u).origin!==origin){errors.push('external '+u);return route.abort();}
  return route.continue();
 });
 let result;
 const filename='sweep'+round+'-'+canvas.w+'x'+canvas.h;
 try{
  await page.goto(origin+'/aa-precision.html',{waitUntil:'load',timeout:30000});
  await page.waitForFunction(()=>!!window.PFX_AA,null,{timeout:120000});
  const tasks=(round===1?cases:[...cases].reverse()).map(index=>({index,state:states[index],regions:regions(canvas,index)}));
  result=await page.evaluate(({canvas,tasks,pads})=>{
   const api=window.PFX_AA;if(!api.ready||typeof api.boundaryEffect!=='function')throw Error('Pinned WASM absent '+api.error);
   const {w,h}=canvas;
   function expanded(r,p){
    const x=Math.max(0,r.x-p),y=Math.max(0,r.y-p);
    const x1=Math.min(w,r.x+r.w+p),y1=Math.min(h,r.y+r.h+p);
    return {x,y,w:x1-x,h:y1-y};
   }
   function raw(s,r,canonical){
    const v=api.boundaryEffect(w,h,r.x,r.y,r.w,r.h,new Float64Array(s.m),
     s.mode,s.shift,s.width,canonical,false);
    if(v.length!==r.w*r.h*4)throw Error('Bad WASM pixels '+JSON.stringify(r));
    return v;
   }
   function equal(reference,rendered,fullSource,requested,showSamples){
    let changes=0,maxDelta=0,paint=0;const samples=[];
    for(let y=0;y<requested.h;y++)for(let x=0;x<requested.w;x++){
     const fi=((requested.y+y)*w+requested.x+x)*4;
     const ri=((requested.y-fullSource.y+y)*fullSource.w+(requested.x-fullSource.x+x))*4;
     let any=false;
     for(let ch=0;ch<4;ch++){
      const a=reference[fi+ch],b=rendered[ri+ch],delta=Math.abs(a-b);
      if(delta>0){
       changes++;any=true;maxDelta=Math.max(maxDelta,delta);
       if(showSamples&&samples.length<5)samples.push({x:requested.x+x,y:requested.y+y,ch,a,b,delta});
      }
     }
     if(any)paint++;
    }
    return {channels:changes,pixels:paint,maxDelta,samples};
   }
   const fullrect={x:0,y:0,w,h},records=[];
   for(const task of tasks){
    const full=raw(task.state,fullrect,false);
    const fullCanonical=raw(task.state,fullrect,true);
    let fullChanges=0;for(let j=0;j<full.length;j++)if(full[j]!==fullCanonical[j])fullChanges++;
    const tested=[];
    for(const roi of task.regions){
     const entries=[];
     for(const pad of pads){
      const source=expanded(roi,pad);
      const v=raw(task.state,source,true);
      const compare=equal(full,v,source,roi,pad===0||pad===16||pad===48);
      entries.push({pad,source,channels:compare.channels,pixels:compare.pixels,
       maxDelta:compare.maxDelta,samples:compare.samples,
       isFull:source.x===0&&source.y===0&&source.w===w&&source.h===h});
     }
     const passing=entries.filter(x=>x.channels===0);
     tested.push({roi,firstExactPad:passing.length?passing[0].pad:null,
      paddedPassIsNonFull:passing.some(x=>!x.isFull),
      entries});
    }
    records.push({index:task.index,mode:task.state.mode,fullChanges,tiles:tested});
   }
   return {canvas,records,pads};
  },{canvas,tasks,pads});
  if(errors.length)throw Error('Browser errors '+errors.join(';'));
  const regress=result.records.flatMap(x=>x.tiles.filter(t=>t.roi.kind==='previous-failing-grid'&&t.entries[0].channels>0).map(t=>({index:x.index,mode:x.mode,roi:t.roi,changes:t.entries[0].channels})));
  const nativeChanges=result.records.reduce((n,x)=>n+x.tiles.reduce((m,t)=>m+t.entries[0].channels,0),0);
  const foundNonFull=result.records.filter(x=>x.tiles.some(t=>t.firstExactPad!==null&&t.paddedPassIsNonFull)).length;
  const unresolved=result.records.reduce((n,x)=>n+x.tiles.filter(t=>t.firstExactPad===null).length,0);
  result.negativeCases=regress;result.nativeChanges=nativeChanges;
  result.nonFullExactSceneCount=foundNonFull;result.unresolved=unresolved;result.errors=errors;
  // This is a diagnostic, not an invented universal correctness certificate.
  result.status=result.records.every(x=>x.fullChanges===0)&&foundNonFull>0?'PASS':'FAIL';
  writeFileSync(path.join(out,filename+'.json'),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(result.status+' '+filename+' nativeChanged='+nativeChanges+
   ' replicatedOldTiles='+regress.length+' nonFullScenes='+foundNonFull+' unresolved='+unresolved+'\n');
  return result;
 }catch(e){
  writeFileSync(path.join(out,filename+'-error.json'),JSON.stringify({error:String(e),errors,result},null,2)+'\n');
  process.stderr.write('ERROR '+filename+' '+String(e)+'\n');
  return {status:'FAIL',canvas,round,error:String(e)};
 }finally{await context.close();}
}
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox',
 '--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const runs=[];
  for(let round=1;round<=2;round++)
   for(const size of round===1?sizes:[...sizes].reverse())
    runs.push(await examine(browser,origin,size,round));
  const summary={status:runs.every(r=>r.status==='PASS')?'PASS':'FAIL',
   negativeTiles:runs.reduce((n,r)=>n+(r.negativeCases?.length||0),0),
   nativeChannelChanges:runs.reduce((n,r)=>n+(r.nativeChanges||0),0),
   nonFullExactSceneCount:runs.reduce((n,r)=>n+(r.nonFullExactSceneCount||0),0),
   unresolved:runs.reduce((n,r)=>n+(r.unresolved||0),0),
   runs:runs.map(r=>({canvas:r.canvas,round:r.round,status:r.status,error:r.error,
    negativeCases:r.negativeCases,nativeChanges:r.nativeChanges,
    nonFullExactSceneCount:r.nonFullExactSceneCount,unresolved:r.unresolved})),
   constraints:['This sweep measures actual source-built CPU WASM under 11 requested scene states and multiple dirty origins.',
   'Padded halos are rendered through the genuine local Vello renderer; full frame references ONLY verify equality.',
   'Pad selection from this test is diagnostic post-hoc, not a production-safe universal rule.',
   'A tile with zero mismatches at one pad does not prove that all origins, scales, filters or mask states are safe.',
   'No native/GPU measurements and no production branch merge.']};
  writeFileSync(path.join(out,'halo-precision-summary.json'),JSON.stringify(summary,null,2)+'\n');
  process.stdout.write('SUMMARY '+summary.status+' nativeChannels='+summary.nativeChannelChanges+
   ' replicatedOldTiles='+summary.negativeTiles+' fullRegionExactScenes='+summary.nonFullExactSceneCount+'\n');
  if(summary.status!=='PASS')process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
