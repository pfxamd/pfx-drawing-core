'use strict';
// Reproducible source-built Vello CPU raster diagnostics, not a hardware GPU test.
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const root=path.resolve(process.env.PFX_WEBROOT || '');
const output=path.resolve(process.env.PFX_PROOF_DIR || '');
if(!process.env.PFX_WEBROOT || !process.env.PFX_PROOF_DIR)throw Error('Missing proof paths');
mkdirSync(output,{recursive:true});
const server=createServer((req,res)=>{
  let file;
  try{file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}
  catch{res.writeHead(400);return res.end();}
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try{
    const ext=path.extname(file);
    res.writeHead(200,{'Content-Type':ext==='.wasm'?'application/wasm':ext==='.js'?'application/javascript':ext==='.html'?'text/html':'application/octet-stream','Cache-Control':'no-store'});
    res.end(readFileSync(file));
  }catch(error){res.writeHead(404);res.end(String(error));}
});
const scenes=[
  {name:'identity',zoom:1,rotation:0,dx:0,dy:0},
  {name:'fractional-translation',zoom:1,rotation:0,dx:0.375,dy:-0.625},
  {name:'zoom-out',zoom:0.85,rotation:0,dx:0.25,dy:-0.25},
  {name:'zoom-in',zoom:1.08,rotation:0,dx:0,dy:0},
  {name:'rotation',zoom:1,rotation:0.09,dx:0,dy:0},
  {name:'combined',zoom:0.95,rotation:-0.07,dx:0.5,dy:0.25},
];

async function scenario(browser, origin, spec, round) {
  const context=await browser.newContext({viewport:{width:800,height:500},deviceScaleFactor:1});
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
  let report;
  try {
    await page.goto(origin+'/aa-precision.html',{waitUntil:'load',timeout:30000});
    await page.waitForFunction(()=>window.PFX_AA!==undefined,null,{timeout:120000});
    const ready=await page.evaluate(()=>({ready:window.PFX_AA.ready,error:window.PFX_AA.error}));
    if(!ready.ready)throw Error('Vello WASM init failed: '+ready.error);
    report=await page.evaluate(spec=>{
      const render=window.PFX_AA.render;
      const fullW=800,fullH=500;
      const core={x:448,y:96,w:336,h:256};
      const pads=[0,8,16,32],frames=[0,43,97,159],formats=[false,true];
      const labels={false:'straight',true:'premultiplied'};
      const data={};
      const results={};
      let alphaPixels=0,motionPixels=0,motionOutsideCore=0;
      let originalExportMismatch=0;
      const opts=[spec.zoom,spec.rotation,spec.dx,spec.dy];
      const raster=(frame,r,premul)=>{
        const bytes=render(frame,r.x,r.y,r.w,r.h,...opts,premul);
        if(bytes.length!==r.w*r.h*4)throw Error('Invalid RGBA buffer size: '+JSON.stringify(r));
        return bytes;
      };
      for(const format of formats)for(const pad of pads){
        const key=labels[format]+'-'+pad;
        data[key]={mismatchChannels:0,maxDelta:0,channelsCompared:0,byChannel:[0,0,0,0],
          nearCoreBoundary:0,interior:0,differences:[],byFrame:[],
          mismatchIds:new Set()};
      }
      let prevStraight=null;
      for(const frame of frames){
        const straight=raster(frame,{x:0,y:0,w:fullW,h:fullH},false);
        const raw=raster(frame,{x:0,y:0,w:fullW,h:fullH},true);
        if(spec.name==='identity'){
          const original=window.PFX_AA.originalRender(frame);
          for(let i=0;i<straight.length;i++)if(straight[i]!==original[i])originalExportMismatch++;
        }
        for(let y=core.y;y<core.y+core.h;y++)for(let x=core.x;x<core.x+core.w;x++){
          const i=(y*fullW+x)*4;
          if(straight[i+3]>0&&straight[i+3]<255)alphaPixels++;
          if(prevStraight && (
            Math.abs(straight[i]-prevStraight[i])+
            Math.abs(straight[i+1]-prevStraight[i+1])+
            Math.abs(straight[i+2]-prevStraight[i+2]) > 50))motionPixels++;
        }
        if(prevStraight)for(let y=0;y<fullH;y++)for(let x=0;x<fullW;x++){
          if(x>=core.x&&x<core.x+core.w&&y>=core.y&&y<core.y+core.h)continue;
          const i=(y*fullW+x)*4;
          if(straight[i]!==prevStraight[i]||straight[i+1]!==prevStraight[i+1]||
             straight[i+2]!==prevStraight[i+2]||straight[i+3]!==prevStraight[i+3])motionOutsideCore++;
        }
        prevStraight=straight;
        for(const format of formats){
          const full=format?raw:straight;
          for(const pad of pads){
            const r={x:core.x-pad,y:core.y-pad,
              w:Math.min(fullW,core.x+core.w+pad)-(core.x-pad),
              h:Math.min(fullH,core.y+core.h+pad)-(core.y-pad)};
            const part=raster(frame,r,format),d=data[labels[format]+'-'+pad];
            let frameMismatches=0;
            for(let y=0;y<core.h;y++)for(let x=0;x<core.w;x++){
              const source=((core.y+y)*fullW+core.x+x)*4;
              const tile=((y+pad)*r.w+x+pad)*4;
              const edgeDistance=Math.min(x,y,core.w-1-x,core.h-1-y);
              for(let channel=0;channel<4;channel++){
                const delta=Math.abs(full[source+channel]-part[tile+channel]);
                d.channelsCompared++;
                if(delta===0)continue;
                const id=frame+':'+source+':'+channel;
                d.mismatchIds.add(id);
                d.mismatchChannels++;frameMismatches++;
                d.maxDelta=Math.max(d.maxDelta,delta);
                d.byChannel[channel]++;
                if(edgeDistance<8)d.nearCoreBoundary++;else d.interior++;
                if(d.differences.length<12)d.differences.push({
                  frame,x:core.x+x,y:core.y+y,channel,
                  full:full[source+channel],region:part[tile+channel],delta,edgeDistance
                });
              }
            }
            d.byFrame.push({frame,mismatchChannels:frameMismatches});
          }
        }
      }
      for(const pad of pads){
        const a=data['straight-'+pad].mismatchIds,b=data['premultiplied-'+pad].mismatchIds;
        let both=0;
        for(const id of a)if(b.has(id))both++;
        const straightOnly=a.size-both,rawOnly=b.size-both;
        for(const fmt of ['straight','premultiplied']){
          const d=data[fmt+'-'+pad];
          results[fmt+'-'+pad]={
            mismatchChannels:d.mismatchChannels,
            channelsCompared:d.channelsCompared,
            mismatchRate:d.mismatchChannels/d.channelsCompared,
            maxDelta:d.maxDelta,byChannel:d.byChannel,nearCoreBoundary:d.nearCoreBoundary,
            interior:d.interior,byFrame:d.byFrame,differences:d.differences,
            byteExact:d.mismatchChannels===0,
            // Classification is per matching frame, channel and coordinate.
            sharedWithOtherFormat:both,straightOnly,rawOnly,
          };
        }
      }
      const timings={};
      const benchFrames=Array.from({length:24},(_,i)=>43+i);
      for(const pad of ['full',...pads]){
        const r=pad==='full'?{x:0,y:0,w:800,h:500}:
          {x:core.x-pad,y:core.y-pad,
            w:Math.min(fullW,core.x+core.w+pad)-(core.x-pad),
            h:Math.min(fullH,core.y+core.h+pad)-(core.y-pad)};
        // Warm up this exact call before collecting CPU-side wall-clock timings.
        for(let i=0;i<3;i++)raster(40+i,r,false);
        const durations=[];
        for(const frame of benchFrames){
          const started=performance.now();
          raster(frame,r,false);
          durations.push(performance.now()-started);
        }
        const sorted=[...durations].sort((a,b)=>a-b);
        timings[String(pad)]={
          samples:durations.length,
          medianMs:sorted[Math.floor(sorted.length/2)],
          p95Ms:sorted[Math.ceil(sorted.length*0.95)-1],
          pixels:r.w*r.h,rgbaBytesPerCall:r.w*r.h*4
        };
      }
      return {spec,frames,pads,core,alphaPixels,motionPixels,motionOutsideCore,
        originalExportMismatch,results,timings,
        renderer:'Vello CPU WASM; independent clip rasterization'};
    },spec);
    if(round===1){
      await page.evaluate(s=>window.PFX_AA.display(97,s.zoom,s.rotation,s.dx,s.dy),spec);
      await page.screenshot({path:path.join(output,spec.name+'-frame97.png')});
    }
    const fails=[];
    if(errors.length||external.length)fails.push('Runtime error or external request');
    if(report.alphaPixels<25)fails.push('Antialiasing not exercised');
    if(report.motionPixels<100)fails.push('Motion not exercised');
    if(spec.name==='identity'&&report.originalExportMismatch!==0)
      fails.push('Changed legacy full-render output');
    const expectedChannels=336*256*4*4;
    for(const [key,r] of Object.entries(report.results)){
      if(r.channelsCompared!==expectedChannels)fails.push('Incomplete RGBA coverage '+key);
      // The established previous-case correctness envelope; do not hide regressions.
      if(r.maxDelta>1)fails.push('Deviation exceeds established 1/255 envelope '+key+' max='+r.maxDelta);
    }
    report.errors=errors;report.externalRequests=external;
    report.status=fails.length?'FAIL':'PASS';
    if(fails.length)report.failures=fails;
    writeFileSync(path.join(output,'r'+round+'-'+spec.name+'.json'),JSON.stringify(report,null,2)+'\n');
    if(fails.length)throw Error(spec.name+' round '+round+': '+fails.join('; '));
    process.stdout.write('PASS r'+round+' '+spec.name+
      ' straight(0px)='+report.results['straight-0'].mismatchChannels+
      ' premul(0px)='+report.results['premultiplied-0'].mismatchChannels+'\n');
    return report;
  } catch(error){
    writeFileSync(path.join(output,'r'+round+'-'+spec.name+'-failure.json'),
      JSON.stringify({error:String(error),report,errors,external},null,2)+'\n');
    throw error;
  } finally {await context.close();}
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,args:[
    '--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'
  ]});
  try {
    const report=[],errors=[];
    const schedules=[scenes,[...scenes].reverse(),[...scenes.slice(3),...scenes.slice(0,3)]];
    // Run all cases even when a correctness gate reveals a new regression.
    for(let round=0;round<schedules.length;round++)for(const scene of schedules[round]){
      try{report.push(await scenario(browser,origin,scene,round+1))}
      catch(e){errors.push(String(e));process.stderr.write('FAIL '+String(e)+'\n')}
    }
    const summary={
      status:errors.length?'FAIL':'PASS',
      casesPassed:report.length,casesAttempted:scenes.length*schedules.length,
      errors,observations:report.map(r=>({
        scene:r.spec.name,
        baselineStraight:r.results['straight-0'].mismatchChannels,
        baselinePremul:r.results['premultiplied-0'].mismatchChannels,
        straightByPadding:[0,8,16,32].map(p=>r.results['straight-'+p].mismatchChannels),
        rawByPadding:[0,8,16,32].map(p=>r.results['premultiplied-'+p].mismatchChannels),
        motionOutsideCore:r.motionOutsideCore,
        timings:r.timings,
      })),
      caveats:[
        'Source-built Vello CPU WASM, headless Chromium; no hardware GPU timings.',
        'Comparisons are to independent full-frame rerasterization, not a golden image.',
        'Padding is independently rasterized and cropped to the original core rectangle.',
        'CPU-side synchronous WASM call times, not paint/composite or GPU transfer times.',
        'Three browser contexts per transform, not a cross-platform or backend guarantee.',
        'Moving pixels outside the fixed core invalidate this core as complete scene damage bounds.',
        'PASS does not mean byte-exact; numeric differences remain explicit.',
      ]
    };
    writeFileSync(path.join(output,'aa-precision-summary.json'),JSON.stringify(summary,null,2)+'\n');
    if(errors.length)process.exitCode=1;
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
