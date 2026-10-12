'use strict';
// Independent full-vs-tile source-built Vello CPU proof, plus actual sequential
// byte copying from independently rasterized damage tiles. No real GPU claims.
const {chromium}=require('playwright');
const {createServer}=require('node:http');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const path=require('node:path');
if(!process.env.PFX_WEBROOT||!process.env.PFX_PROOF_DIR)throw Error('Paths required');
const root=path.resolve(process.env.PFX_WEBROOT),out=path.resolve(process.env.PFX_PROOF_DIR);
mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm'};
const server=createServer((req,res)=>{
 let f;
 try{f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}
 catch{res.writeHead(400);return res.end()}
 if(!f.startsWith(root+path.sep)){res.writeHead(403);return res.end()}
 try{res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(f))}
 catch(e){res.writeHead(404);res.end(String(e))}
});
const canvases=[{w:640,h:400},{w:800,h:500},{w:1024,h:640}];
const modes=[{name:'normal',id:0},{name:'multiply',id:1},{name:'screen',id:2},{name:'overlay',id:3},{name:'clipped-multiply',id:4}];
const frames=[0,27,63,111];
const warmups=4,perfSamples=20;
function regionsFor({w,h}){
 const a=[Math.floor(w*0.46),Math.floor(h*0.19)];
 const b=[Math.floor(w*0.54),Math.floor(h*0.27)];
 const c=[Math.floor(w*0.63),Math.floor(h*0.34)];
 return [a,b,c].map(([x,y],i)=>({name:'tile'+i,
  x,y,w:Math.min(w-x,Math.floor(w*(i===0?0.47:0.36))),
  h:Math.min(h-y,Math.floor(h*(i===0?0.69:0.56)))}));
}
async function run(browser,origin,canvas,round){
 const context=await browser.newContext({viewport:{width:1100,height:700},deviceScaleFactor:1});
 const page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
 page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url())});
 await page.route('**/*',route=>{
  const url=route.request().url();
  if(url.startsWith('http')&&new URL(url).origin!==origin){external.push(url);return route.abort()}
  return route.continue();
 });
 const filename='round'+round+'-'+canvas.w+'x'+canvas.h;
 let result;
 try{
  await page.goto(origin+'/aa-precision.html',{waitUntil:'load',timeout:30000});
  await page.waitForFunction(()=>window.PFX_AA!==undefined,null,{timeout:120000});
  result=await page.evaluate(({canvas,modes,frames,round,tiles,warmups,perfSamples})=>{
    const api=window.PFX_AA;
    if(!api.ready||typeof api.layered!=='function')throw Error('New WASM export absent: '+api.error);
    const {w,h}=canvas,referenceRect={x:0,y:0,w,h};
    const render=(frame,r,mode,canonical)=>{
      const bytes=api.layered(w,h,frame,r.x,r.y,r.w,r.h,mode,canonical);
      if(bytes.length!==r.w*r.h*4)throw Error('Wrong rgba length '+JSON.stringify(r));
      return bytes;
    };
    const scan=(reference,other,r,samples)=>{
      const stat={changedChannels:0,changedPixels:0,maxDelta:0,alphaChanges:0};
      for(let y=r.y;y<r.y+r.h;y++){
       const f=(y*w+r.x)*4,t=(y-r.y)*r.w*4;
       for(let x=0;x<r.w;x++){
        let hit=false;
        for(let ch=0;ch<4;ch++){
         const delta=Math.abs(reference[f+x*4+ch]-other[t+x*4+ch]);
         if(!delta)continue;
         stat.changedChannels++;hit=true;
         if(ch===3)stat.alphaChanges++;
         stat.maxDelta=Math.max(stat.maxDelta,delta);
         if(samples.length<5)samples.push({x:r.x+x,y,ch,full:reference[f+x*4+ch],
          tile:other[t+x*4+ch],delta});
        }
        if(hit)stat.changedPixels++;
       }
      }
      return stat;
    };
    const tally=(out,v)=>{
     out.changedChannels+=v.changedChannels;out.changedPixels+=v.changedPixels;
     out.alphaChanges+=v.alphaChanges;out.maxDelta=Math.max(out.maxDelta,v.maxDelta);
    };
    const empty=()=>({changedChannels:0,changedPixels:0,alphaChanges:0,maxDelta:0});
    const paste=(buffer,tile,r)=>{
     for(let y=0;y<r.h;y++)
      buffer.set(tile.subarray(y*r.w*4,(y+1)*r.w*4),((r.y+y)*w+r.x)*4);
    };
    const changedBBox=(oldPixels,newPixels)=>{
     let x0=w,y0=h,x1=0,y1=0,changed=0;
     for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const k=(y*w+x)*4;
      if(oldPixels[k]===newPixels[k]&&oldPixels[k+1]===newPixels[k+1]&&
       oldPixels[k+2]===newPixels[k+2]&&oldPixels[k+3]===newPixels[k+3])continue;
      changed++;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);
     }
     if(!changed)return null;
     // Reference-derived conservative damage bound; deliberately NOT a proposed
     // production invalidation algorithm.
     x0=Math.max(0,x0-9);y0=Math.max(0,y0-9);
     x1=Math.min(w,x1+9);y1=Math.min(h,y1+9);
     return {x:x0,y:y0,w:x1-x0,h:y1-y0,changed};
    };
    const split=(r,layout)=>{
     if(layout==='vertical-overlap'){
      const mid=r.x+Math.floor(r.w/2);
      const a=Math.max(r.x,mid-8),b=Math.min(r.x+r.w,mid+8);
      return [{x:r.x,y:r.y,w:b-r.x,h:r.h},
              {x:a,y:r.y,w:r.x+r.w-a,h:r.h}];
     }
     const mx=r.x+Math.floor(r.w/2),my=r.y+Math.floor(r.h/2);
     const rows=[[r.y,Math.min(r.y+r.h,my+5)],[Math.max(r.y,my-5),r.y+r.h]];
     const cols=[[r.x,Math.min(r.x+r.w,mx+7)],[Math.max(r.x,mx-7),r.x+r.w]];
     return rows.flatMap(([y0,y1])=>cols.map(([x0,x1])=>({x:x0,y:y0,w:x1-x0,h:y1-y0})));
    };
    const ordered=round===1?modes:[...modes].reverse(),cases=[];
    const normalFull=render(frames[0],referenceRect,0,false);
    let blendDifference=0;
    let totalPaintedPixels=0;
    for(const {name,id}of ordered){
     const item={name,id,directOld:empty(),directCanonical:empty(),controlFullChanges:0,
      samples:[],directFrames:[],sequential:[],sequentialErrors:0,
      damageAreaPx:0,fullCanvasAreaPx:0,rasterizedDamagePx:0};
     const fulls=frames.map(frame=>{
      const a=render(frame,referenceRect,id,false);
      const b=render(frame,referenceRect,id,true);
      for(let i=0;i<a.length;i++)if(a[i]!==b[i])item.controlFullChanges++;
      return a;
     });
     for(let frameIndex=0;frameIndex<frames.length;frameIndex++){
      const frame=frames[frameIndex],full=fulls[frameIndex];
      let partialPixels=0;
      for(let i=3;i<full.length;i+=4){
       if(full[i])totalPaintedPixels++;
       if(full[i]>0&&full[i]<255)partialPixels++;
      }
      const frameStat={frame,partialAlphaPixels:partialPixels,old:empty(),canonical:empty()};
      for(const r of tiles){
       const before=render(frame,r,id,false),after=render(frame,r,id,true);
       const oldDiff=scan(full,before,r,[]);
       const newDiff=scan(full,after,r,item.samples);
       tally(frameStat.old,oldDiff);tally(frameStat.canonical,newDiff);
       tally(item.directOld,oldDiff);tally(item.directCanonical,newDiff);
      }
      item.directFrames.push(frameStat);
     }
     if(id!==0){
      const first=fulls[0];
      for(let i=0;i<first.length;i++)if(first[i]!==normalFull[i])blendDifference++;
     }
     // The same moving scene evolves through 3 transitions. At each transition
     // COPY actual independently rendered dirty-tile bytes over the cached
     // previous composited frame, not over a freshly copied full frame.
     for(const layout of ['vertical-overlap','grid-four-overlap']){
      const accumulation=new Uint8Array(fulls[0]);
      const transitions=[];
      for(let fi=1;fi<frames.length;fi++){
       const r=changedBBox(fulls[fi-1],fulls[fi]);
       if(!r)throw Error('Unchanged frame in animated layer mode '+id);
       const pieces=split(r,layout);
       let drawn=0;
       for(const piece of pieces){
        if(piece.w<=0||piece.h<=0)throw Error('Invalid damage tile');
        const pixels=render(frames[fi],piece,id,true);
        paste(accumulation,pixels,piece);
        drawn+=piece.w*piece.h;
       }
       const diff=scan(fulls[fi],accumulation,referenceRect,item.samples);
       item.sequentialErrors+=diff.changedChannels;
       item.damageAreaPx+=r.w*r.h;
       item.rasterizedDamagePx+=drawn;
       item.fullCanvasAreaPx+=w*h;
       transitions.push({from:frames[fi-1],to:frames[fi],changedPixels:r.changed,damage:r,
        tileRects:pieces,tilesRendered:pieces.length,renderedAreaPx:drawn,
        actualFullComparison:diff});
      }
      item.sequential.push({layout,transitions});
     }
     cases.push(item);
    }
    // Time each actual WASM raster path without data tracing or screenshots.
    const mode=4,frame=63,r=tiles[0],timings={full:[],local:[],canonical:[]};
    for(let i=0;i<warmups;i++){
      render(frame,referenceRect,mode,false);
      render(frame,r,mode,false);render(frame,r,mode,true);
    }
    for(let i=0;i<perfSamples;i++){
     const order=i%2===0?['full','local','canonical']:['canonical','local','full'];
     for(const k of order){
      const t=performance.now();
      render(frame,k==='full'?referenceRect:r,mode,k==='canonical');
      timings[k].push(performance.now()-t);
     }
    }
    const timing={};
    for(const [name,values]of Object.entries(timings)){
     values.sort((a,b)=>a-b);
     timing[name]={samples:values.length,medianMs:values[Math.floor(values.length/2)],
      p95Ms:values[Math.ceil(values.length*.95)-1],bytesPerCall:name==='full'?w*h*4:r.w*r.h*4};
    }
    return {canvas,round,frames,tiles,cases,blendDifference,totalPaintedPixels,timing};
  },{canvas,modes,frames,round,tiles:regionsFor(canvas),warmups,perfSamples});
  if(round===1&&canvas.w===800){
    await page.evaluate(()=>{
      const image=window.PFX_AA.layered(800,500,63,0,0,800,500,4,true);
      const el=document.getElementById('output');
      el.width=800;el.height=500;
      el.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image),800,500),0,0);
    });
    await page.screenshot({path:path.join(out,'layered-clipped-blend-800.png')});
  }
  const failures=[];
  if(result.totalPaintedPixels<300)failures.push('Empty scene');
  if(result.blendDifference<100)failures.push('Blend modes not exercised');
  for(const c of result.cases){
    if(c.controlFullChanges!==0)failures.push(c.name+' changed full frame');
    if(c.directCanonical.changedChannels!==0)failures.push(c.name+' subregion mismatch');
    if(c.sequentialErrors!==0)failures.push(c.name+' repaint mismatch');
    if(!c.directFrames.some(f=>f.partialAlphaPixels>100))failures.push(c.name+' no fractional alpha');
  }
  if(errors.length||external.length)failures.push('Browser/network failure');
  result.status=failures.length?'FAIL':'PASS';result.failures=failures;
  result.errors=errors;result.external=external;
  writeFileSync(path.join(out,filename+'.json'),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(result.status+' '+filename+' cases='+result.cases.length+
   ' canonical='+result.cases.reduce((a,c)=>a+c.directCanonical.changedChannels,0)+
   ' repaint='+result.cases.reduce((a,c)=>a+c.sequentialErrors,0)+
   ' legacy='+result.cases.reduce((a,c)=>a+c.directOld.changedChannels,0)+'\n');
  return result;
 }catch(e){
  writeFileSync(path.join(out,filename+'-error.json'),JSON.stringify({error:String(e),result,errors,external},null,2)+'\n');
  process.stderr.write('ERROR '+filename+' '+String(e)+'\n');
  return {status:'FAIL',canvas,round,error:String(e)};
 }finally{await context.close()}
}
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl',
   '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const results=[];
  for(let round=1;round<=2;round++)
   for(const canvas of round===1?canvases:[...canvases].reverse())
    results.push(await run(browser,origin,canvas,round));
  const status=results.every(x=>x.status==='PASS')?'PASS':'FAIL';
  const summary={status,expectedCases:canvases.length*modes.length*2,
   verifiedCases:results.reduce((a,r)=>a+(r.cases?.length||0),0),
   results:results.map(r=>({canvas:r.canvas,round:r.round,status:r.status,
     failures:r.failures,error:r.error,
     blendDifference:r.blendDifference,paintedPixels:r.totalPaintedPixels,
     timing:r.timing,cases:r.cases?.map(c=>({name:c.name,old:c.directOld,
       canonical:c.directCanonical,sequentialErrors:c.sequentialErrors,
       damageAreaPx:c.damageAreaPx,fullCanvasAreaPx:c.fullCanvasAreaPx,
       rasterizedDamagePx:c.rasterizedDamagePx}))})),
   scope:[
     'Source-built pinned Vello CPU WASM, no hardware GPU measurements.',
     'Actual layers: parent opacity 0.71, nested blend group and opacity 0.59, optional path clip.',
     'Each region compares all RGBA channels and all pixels of its own extent.',
     'Sequential buffers start from first full reference only, then copy separate true WASM dirty renders.',
     'Damage rectangle conservatively derived from exact pixel differences of the full reference: oracle, not automatic scene damage detection.',
     'The three frames use two overlapping tile layouts, each fully verified against an independent full reference.',
     'No real browser Canvas2D/GPU compositor interaction or multi-threaded rendering tested; no production merge.'
   ]};
  writeFileSync(path.join(out,'layered-repaint-summary.json'),JSON.stringify(summary,null,2)+'\n');
  process.stdout.write('SUMMARY '+summary.verifiedCases+'/'+summary.expectedCases+' '+status+'\n');
  if(status!=='PASS')process.exitCode=1;
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
