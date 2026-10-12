'use strict';
// Strict full-frame versus independent-tile RGBA test. Software Vello CPU,
// never a claim about native GPU rendering or browser-compositor performance.
const {chromium}=require('playwright');
const {createServer}=require('node:http');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const path=require('node:path');
const root=path.resolve(process.env.PFX_WEBROOT||'');
const out=path.resolve(process.env.PFX_PROOF_DIR||'');
if(!process.env.PFX_WEBROOT||!process.env.PFX_PROOF_DIR)throw Error('Missing test paths');
mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm'};
const server=createServer((req,res)=>{
  let file;
  try{file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}
  catch{res.writeHead(400);return res.end();}
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try{res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(file))}
  catch(e){res.writeHead(404);res.end(String(e))}
});
const canvases=[
 {width:640,height:400,regions:[
  [352,64,288,336],[368,80,272,320],[384,96,256,304]
 ]},
 {width:800,height:500,regions:[
  [384,64,416,384],[400,80,400,368],[416,96,384,352]
 ]},
 {width:1024,height:640,regions:[
  [384,64,448,416],[400,80,448,400],[416,96,432,384]
 ]}
];
const modes=[
 {name:'bezier-fills',bits:1},
 {name:'thick-bezier-stroke',bits:2},
 {name:'clipped-bezier-fills',bits:5},
 {name:'clipped-fill-and-stroke',bits:7}
];
const transforms=[
 {name:'identity',zoom:1,rotation:0,dx:0,dy:0},
 {name:'zoom-and-subpixel',zoom:1.08,rotation:0,dx:0.375,dy:-0.625},
 {name:'rotation-combined',zoom:0.93,rotation:0.09,dx:-0.25,dy:0.5}
];
const frames=[0,43,159];

async function verify(browser,origin,canvas,round){
 const context=await browser.newContext({viewport:{width:1050,height:700},deviceScaleFactor:1});
 const page=await context.newPage();
 const errors=[],external=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
 page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url())});
 await page.route('**/*',route=>{
  const url=route.request().url();
  if(url.startsWith('http')&&new URL(url).origin!==origin){external.push(url);return route.abort();}
  return route.continue();
 });
 const filename='r'+round+'-'+canvas.width+'x'+canvas.height;
 let report;
 try {
  await page.goto(origin+'/aa-precision.html',{waitUntil:'load',timeout:30000});
  await page.waitForFunction(()=>window.PFX_AA!==undefined,null,{timeout:120000});
  report=await page.evaluate(({canvas,modes,transforms,frames,round})=>{
   const api=window.PFX_AA;if(!api.ready||typeof api.extended!=='function')throw Error('Extended WASM unavailable');
   const render=(frame,r,mode,transform,canonical)=>{
    const b=api.extended(canvas.width,canvas.height,frame,...r,mode.bits,
      transform.zoom,transform.rotation,transform.dx,transform.dy,canonical);
    if(b.length!==r[2]*r[3]*4)throw Error('Invalid RGBA size');
    return b;
   };
   const base=[0,0,canvas.width,canvas.height];
   const bounds=canvas.regions.reduce((b,r)=>({
    x0:Math.max(b.x0,r[0]),y0:Math.max(b.y0,r[1]),
    x1:Math.min(b.x1,r[0]+r[2]),y1:Math.min(b.y1,r[1]+r[3])
   }),{x0:0,y0:0,x1:canvas.width,y1:canvas.height});
   if(bounds.x0>=bounds.x1||bounds.y0>=bounds.y1)throw Error('No shared clip intersection');
   const cases=[],errors=[];
   let fullReferenceChanged=0,totalReferenceColoredPixels=0,totalPixelsCompared=0;
   const settings=[];
   for(const mode of modes)for(const transform of transforms)settings.push({mode,transform});
   if(round===2)settings.reverse();
   for(const {mode,transform}of settings){
    const item={name:mode.name+' / '+transform.name,mode:mode.name,transform:transform.name,
     legacyChannels:0,canonicalChannels:0,legacyMaxDelta:0,canonicalMaxDelta:0,
     legacyAlpha:0,canonicalAlpha:0,comparedChannels:0,comparedPixels:0,
     byFrame:[],samples:[],referenceColoredPixels:0};
    for(const frame of frames){
     const full=render(frame,base,mode,transform,false);
     const fullAlt=render(frame,base,mode,transform,true);
     for(let i=0;i<full.length;i++)if(full[i]!==fullAlt[i])fullReferenceChanged++;
     for(let y=bounds.y0;y<bounds.y1;y++)for(let x=bounds.x0;x<bounds.x1;x++)
      if(full[(y*canvas.width+x)*4+3]>0){item.referenceColoredPixels++;totalReferenceColoredPixels++;}
     for(const r of canvas.regions){
      const control=render(frame,r,mode,transform,false);
      const canonical=render(frame,r,mode,transform,true);
      let original=0,updated=0;
      for(let y=bounds.y0;y<bounds.y1;y++){
       let fullIdx=(y*canvas.width+bounds.x0)*4;
       let tileIdx=((y-r[1])*r[2]+bounds.x0-r[0])*4;
       const steps=bounds.x1-bounds.x0;
       for(let x=0;x<steps;x++,fullIdx+=4,tileIdx+=4){
        item.comparedPixels++;totalPixelsCompared++;
        for(let ch=0;ch<4;ch++){
         const oldDelta=Math.abs(full[fullIdx+ch]-control[tileIdx+ch]);
         const newDelta=Math.abs(full[fullIdx+ch]-canonical[tileIdx+ch]);
         if(oldDelta){
          item.legacyChannels++;original++;
          item.legacyMaxDelta=Math.max(item.legacyMaxDelta,oldDelta);
          if(ch===3)item.legacyAlpha++;
         }
         if(newDelta){
          item.canonicalChannels++;updated++;
          item.canonicalMaxDelta=Math.max(item.canonicalMaxDelta,newDelta);
          if(ch===3)item.canonicalAlpha++;
          if(item.samples.length<8)item.samples.push({
           frame,region:r,x:bounds.x0+x,y,channel:ch,
           reference:full[fullIdx+ch],canonical:canonical[tileIdx+ch],delta:newDelta
          });
         }
         item.comparedChannels++;
        }
       }
      }
      item.byFrame.push({frame,region:r,legacyChannels:original,canonicalChannels:updated});
     }
    }
    if(item.referenceColoredPixels===0)errors.push('Scene has no painted pixels: '+item.name);
    cases.push(item);
   }
   // Interleaved controlled call timings, without trace collection. This is
   // CPU-side synchronous WASM time only.
   const primary=modes[3],xf=transforms[2],tile=canvas.regions[0];
   for(let i=0;i<4;i++){
    render(30+i,tile,primary,xf,false);
    render(30+i,tile,primary,xf,true);
    render(30+i,base,primary,xf,false);
   }
   const times={full:[],local:[],canonical:[]};
   for(let i=0;i<18;i++)for(const item of i%2?
    [['canonical',tile,true],['local',tile,false],['full',base,false]]:
    [['full',base,false],['local',tile,false],['canonical',tile,true]]){
     const t=performance.now();render(53+i,item[1],primary,xf,item[2]);
     times[item[0]].push(performance.now()-t);
   }
   const timingStats={};
   for(const [k,values]of Object.entries(times)){
    values.sort((a,b)=>a-b);
    timingStats[k]={samples:values.length,medianMs:values[Math.floor(values.length/2)],
     p95Ms:values[Math.ceil(values.length*.95)-1],
     rgbaBytesPerCall:(k==='full'?canvas.width*canvas.height*4:tile[2]*tile[3]*4)};
   }
   return {canvas,round,bounds,cases,performance:timingStats,fullReferenceChanged,
    totalReferenceColoredPixels,totalPixelsCompared,errors};
  },{canvas,modes,transforms,frames,round});
  if(round===1&&canvas.width===800){
   await page.evaluate(()=>{
    const doc=document.getElementById('output');
    doc.width=800;doc.height=500;
    const image=window.PFX_AA.extended(800,500,43,0,0,800,500,7,0.93,0.09,-0.25,0.5,true);
    doc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image),800,500),0,0);
   });
   await page.screenshot({path:path.join(out,'mixed-clipped-stroke-800x500.png')});
  }
  const failures=[...report.errors];
  if(report.fullReferenceChanged!==0)failures.push('Canonical full-canvas baseline altered');
  if(report.totalReferenceColoredPixels<100)failures.push('Scenes not exercised');
  if(report.totalPixelsCompared<=0)failures.push('No pixels compared');
  // The final decision is strict byte equality, NOT the old one-byte tolerance.
  const nonExact=report.cases.filter(c=>c.canonicalChannels!==0);
  if(nonExact.length)failures.push(nonExact.length+' cases not byte exact (recorded explicitly)');
  if(errors.length||external.length)failures.push('Browser error or external request');
  report.status=failures.length?'FAIL':'PASS';report.failures=failures;
  report.browserErrors=errors;report.externalRequests=external;
  writeFileSync(path.join(out,filename+'.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(report.status+' '+filename+' cases='+report.cases.length+
   ' nonExact='+nonExact.length+' baselineDifferences='+report.cases.reduce((a,c)=>a+c.legacyChannels,0)+
   ' canonicalDifferences='+report.cases.reduce((a,c)=>a+c.canonicalChannels,0)+'\n');
  return report;
 }catch(e){
  writeFileSync(path.join(out,filename+'-error.json'),JSON.stringify({error:String(e),report,errors,external},null,2)+'\n');
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
  const runs=[];
  for(let round=1;round<=2;round++){
   const order=round===1?canvases:[...canvases].reverse();
   for(const canvas of order)runs.push(await verify(browser,origin,canvas,round));
  }
  const failures=runs.filter(r=>r.status!=='PASS');
  const total=runs.reduce((a,r)=>a+(r.cases?.length||0),0);
  const exact=runs.reduce((a,r)=>a+(r.cases?.filter(c=>c.canonicalChannels===0).length||0),0);
  const summary={status:failures.length?'FAIL':'PASS',contexts:runs.length,
   cases:total,exact,nonExact:total-exact,runs:runs.map(r=>({
    canvas:r.canvas,round:r.round,status:r.status,failures:r.failures,
    errors:r.error,totalPixelsCompared:r.totalPixelsCompared,
    legacyChannelDiffs:r.cases?.reduce((a,c)=>a+c.legacyChannels,0),
    canonicalChannelDiffs:r.cases?.reduce((a,c)=>a+c.canonicalChannels,0),
    byCase:r.cases?.map(c=>({name:c.name,legacyChannels:c.legacyChannels,
      canonicalChannels:c.canonicalChannels,canonicalMaxDelta:c.canonicalMaxDelta,
      legacyMaxDelta:c.legacyMaxDelta,nonzeroPixels:c.referenceColoredPixels})),
    performance:r.performance
   })),
   limitations:[
    'Pinned Vello CPU WASM, software headless Chromium, no physical GPU performance.',
    'Exact RGBA comparison of full canvas versus each independent subregion in their common intersection.',
    'Fixed manually defined dirty regions; not automatic damage detection or composited 2D+3D frames.',
    'Selected path and clip geometry and selected sample frames; not a universal proof.',
    'Canonical global bbox is dynamic in this branch; clipping/stroke algorithms remain Vello upstream with experimental rebasing.',
    'No integration or merge into main.'
   ]
  };
  writeFileSync(path.join(out,'aa-extended-summary.json'),JSON.stringify(summary,null,2)+'\n');
  process.stdout.write('SUMMARY '+exact+'/'+total+' byte-exact cases '+summary.status+'\n');
  if(failures.length)process.exitCode=1;
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
