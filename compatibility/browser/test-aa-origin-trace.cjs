'use strict';
// Vello CPU source-origin AA trace; non-GPU, no compositor claims.
const { chromium }=require('playwright');
const { createServer }=require('node:http');
const { readFileSync,writeFileSync,mkdirSync }=require('node:fs');
const path=require('node:path');
const root=path.resolve(process.env.PFX_WEBROOT||'');
const out=path.resolve(process.env.PFX_PROOF_DIR||'');
if(!process.env.PFX_WEBROOT||!process.env.PFX_PROOF_DIR)throw Error('Missing paths');
mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm'};
const server=createServer((req,res)=>{
  let file;
  try{file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));}
  catch{res.writeHead(400);return res.end();}
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try{res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(file));}
  catch(e){res.writeHead(404);res.end(String(e));}
});
const scenes=[
  {label:'bars-only',scene:1},
  {label:'blob-a-with-inset',scene:2},
  {label:'blob-b-with-overlap',scene:4},
  {label:'blob-a-single-path',scene:8},
  {label:'blob-b-single-path',scene:16},
  {label:'complete-scene',scene:7}
];
const origins=[
  {label:'original',x:448,y:96,w:336,h:256},
  {label:'plus-one',x:449,y:97,w:335,h:255},
  {label:'plus-eight',x:456,y:104,w:328,h:248},
  {label:'minus-four',x:444,y:92,w:340,h:260},
  {label:'minus-sixteen',x:432,y:80,w:352,h:272}
];
const roi={x:464,y:112,w:312,h:232};
const frames=[0,43,97,159];
const specs=scenes.flatMap(scene=>[false,true].map(quality=>({...scene,quality})));

async function runScenario(browser,origin,spec,round){
  const context=await browser.newContext({viewport:{width:800,height:500},deviceScaleFactor:1});
  const page=await context.newPage();
  const errors=[],outside=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
  page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url())});
  await page.route('**/*',route=>{
    const url=route.request().url();
    if(url.startsWith('http')&&new URL(url).origin!==origin){
      outside.push(url);return route.abort();
    }
    return route.continue();
  });
  const id='r'+round+'-'+spec.label+(spec.quality?'-highp':'-lowp');
  let result;
  try{
    await page.goto(origin+'/aa-precision.html',{waitUntil:'load',timeout:30000});
    await page.waitForFunction(()=>window.PFX_AA!==undefined,null,{timeout:120000});
    result=await page.evaluate(({spec,origins,roi,frames})=>{
      if(!window.PFX_AA.ready)throw Error('Vello not ready '+window.PFX_AA.error);
      const trace=window.PFX_AA.trace,original=window.PFX_AA.originalRender;
      if(typeof trace!=='function')throw Error('Missing instrumented WASM export');
      const full={x:0,y:0,w:800,h:500};
      const raster=(f,r,quality)=> {
        const bytes=trace(f,r.x,r.y,r.w,r.h,1,0,0,0,true,spec.scene,quality);
        if(bytes.length!==r.w*r.h*4)throw Error('Invalid RGBA buffer length');
        return bytes;
      };
      const output={spec,roi,frames,regions:{},legacyByteDiffs:0,nontransparent:0,
        renderMs:{full:[],tile:[]},crossFormatAlphaMismatch:0};
      const compare=(reference,tile,r,fullAlphaDifference)=>{
        const stats={wrongChannels:0,wrongPixels:0,wrongAlpha:0,wrongRgb:0,
          maxDelta:0,byChannel:[0,0,0,0],nontransparent:0,examples:[],differentIds:[]};
        for(let y=roi.y;y<roi.y+roi.h;y++)for(let x=roi.x;x<roi.x+roi.w;x++){
          const a=(y*800+x)*4,b=((y-r.y)*r.w+x-r.x)*4;
          let wrong=false;
          if(reference[a+3]>0)stats.nontransparent++;
          for(let c=0;c<4;c++){
            const diff=Math.abs(reference[a+c]-tile[b+c]);
            if(diff===0)continue;
            stats.wrongChannels++;
            stats.byChannel[c]++;
            if(c===3)stats.wrongAlpha++;else stats.wrongRgb++;
            stats.maxDelta=Math.max(diff,stats.maxDelta);
            if(!wrong){stats.wrongPixels++;wrong=true;}
            if(stats.examples.length<10)stats.examples.push({x,y,channel:c,full:reference[a+c],clip:tile[b+c],delta:diff});
            stats.differentIds.push((y*800+x)*4+c);
          }
        }
        return stats;
      };
      const aggregates=Object.fromEntries(origins.map(r=>[r.label,{
        wrongChannels:0,wrongPixels:0,wrongAlpha:0,wrongRgb:0,
        byChannel:[0,0,0,0],maxDelta:0,nontransparent:0,examples:[],
        mismatchIds:new Set(),byFrame:[]
      }]));
      for(const frame of frames){
        const fullRgba=raster(frame,full,spec.quality);
        if(spec.scene===7&&!spec.quality){
          const previous=original(frame);
          for(let i=0;i<previous.length;i++)if(previous[i]!==fullRgba[i])output.legacyByteDiffs++;
        }
        for(let y=roi.y;y<roi.y+roi.h;y++)for(let x=roi.x;x<roi.x+roi.w;x++){
          if(fullRgba[(y*800+x)*4+3]>0)output.nontransparent++;
        }
        // Different region origins: identical global scene, independent rasterization.
        for(const r of origins){
          const tile=raster(frame,r,spec.quality);
          const check=compare(fullRgba,tile,r);
          const acc=aggregates[r.label];
          for(const field of ['wrongChannels','wrongPixels','wrongAlpha','wrongRgb','nontransparent'])
            acc[field]+=check[field];
          acc.maxDelta=Math.max(acc.maxDelta,check.maxDelta);
          for(let i=0;i<4;i++)acc.byChannel[i]+=check.byChannel[i];
          acc.byFrame.push({frame,wrongChannels:check.wrongChannels,wrongAlpha:check.wrongAlpha});
          acc.mismatchIds.add(frame+':'+r.label+':'+check.wrongChannels);
          if(acc.examples.length<10)acc.examples.push(...check.examples.slice(0,10-acc.examples.length));
        }
      }
      for(const r of origins){
        const a=aggregates[r.label];
        delete a.mismatchIds;
        output.regions[r.label]=a;
      }
      const benchmark=(r,key)=>{
        for(let j=0;j<5;j++)raster(77+j,r,spec.quality);
        for(let j=0;j<20;j++){
          const t=performance.now();
          raster(90+j,r,spec.quality);
          output.renderMs[key].push(performance.now()-t);
        }
      };
      benchmark(full,'full');benchmark(origins[0],'tile');
      return output;
    },{spec,origins,roi,frames});
    if(round===1&&spec.scene===7&&!spec.quality){
      await page.evaluate(()=>window.PFX_AA.display(97,1,0,0,0));
      await page.screenshot({path:path.join(out,'full-complex-reference.png')});
    }
    const problems=[];
    if(result.nontransparent<200)problems.push('No painted pixels in ROI');
    if(errors.length||outside.length)problems.push('Unexpected browser error/network request');
    if(result.legacyByteDiffs!==0)problems.push('Legacy baseline changed');
    for(const [name,r]of Object.entries(result.regions)){
      if(r.maxDelta>1)problems.push(name+' exceeds old 1/255 envelope: '+r.maxDelta);
      if(!r.byFrame||r.byFrame.length!==frames.length)problems.push(name+' missing frames');
    }
    result.status=problems.length?'FAIL':'PASS';
    result.errors=errors;result.externalRequests=outside;
    if(problems.length)result.failures=problems;
    writeFileSync(path.join(out,id+'.json'),JSON.stringify(result,null,2)+'\n');
    process.stdout.write(result.status+' '+id+' alpha='+
      result.regions.original.wrongAlpha+' RGB='+result.regions.original.wrongRgb+
      ' max='+result.regions.original.maxDelta+'\n');
    return result;
  }catch(e){
    writeFileSync(path.join(out,id+'-error.json'),JSON.stringify({error:String(e),result,errors,outside},null,2)+'\n');
    process.stderr.write('ERROR '+id+' '+String(e)+'\n');
    return {status:'FAIL',spec,round,error:String(e)};
  }finally{await context.close();}
}
(async()=>{
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const all=[];
    // Separate fresh browser contexts, rotated order, no overlapping contexts.
    for(let round=1;round<=2;round++){
      const order=round===1?specs:[...specs].reverse();
      for(const spec of order)all.push(await runScenario(browser,origin,spec,round));
    }
    const summary={
      status:all.every(x=>x.status==='PASS')?'PASS':'FAIL',
      passed:all.filter(x=>x.status==='PASS').length,
      attempted:all.length,framesPerCase:frames.length,
      results:all.map(x=>({
        spec:x.spec,status:x.status,error:x.error,failures:x.failures,
        originData:x.regions?Object.fromEntries(Object.entries(x.regions).map(([k,v])=>
          [k,{wrongChannels:v.wrongChannels,wrongAlpha:v.wrongAlpha,
            wrongRgb:v.wrongRgb,maxDelta:v.maxDelta}])):null,
        renderMs:x.renderMs?Object.fromEntries(Object.entries(x.renderMs).map(([k,v])=>{
          const s=[...v].sort((a,b)=>a-b);
          return [k,{median:s[Math.floor(s.length/2)],p95:s[Math.ceil(s.length*.95)-1]}];
        })):null
      })),
      caveats:[
        'AA diagnostics use pinned Vello CPU WASM and only isolated RGBA raster calls.',
        'Opacity/alpha from a single opaque filled path is a controlled coverage proxy, not an internal prequantized AA buffer.',
        'The two render modes share preprocessing; their difference concerns the fine color compositing pipeline.',
        'Pass requires regression ceiling (<= 1 byte/channel); does not imply pixel-exact parity.',
        'Fixed ROI and selected four frames only; no GPU, native graphics, automatic damage tracking or shared context verified.'
      ]
    };
    writeFileSync(path.join(out,'aa-origin-summary.json'),JSON.stringify(summary,null,2)+'\n');
    if(summary.status==='FAIL')process.exitCode=1;
    process.stdout.write('SUMMARY '+summary.passed+'/'+summary.attempted+' '+summary.status+'\n');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
