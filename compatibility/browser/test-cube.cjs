'use strict';
const {chromium}=require('playwright');
const {PNG}=require('pngjs');
const {createServer}=require('http');
const {readFileSync,writeFileSync,mkdirSync}=require('fs');
const path=require('path');
const root=path.resolve(process.env.PFX_WEBROOT||'');
const proof=path.resolve(process.env.PFX_PROOF_DIR||'');
if(!process.env.PFX_WEBROOT||!process.env.PFX_PROOF_DIR)throw Error('Missing local webroot/proof paths');
mkdirSync(proof,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm','.filamat':'application/octet-stream'};
const server=createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try{const bytes=readFileSync(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(bytes);}
  catch(error){res.writeHead(404);res.end(String(error));}
});
const rgba=(png,x,y)=>[...png.data.subarray((y*png.width+x)*4,(y*png.width+x)*4+4)];
const distance=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);
const p95=(samples)=>samples.length?[...samples].sort((a,b)=>a-b)[Math.ceil(samples.length*0.95)-1]:null;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/index.html';
  const origin=new URL(url).origin;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const reports=[];
  try {
    for(const dpr of [1,2]){
      const context=await browser.newContext({viewport:{width:800,height:500},deviceScaleFactor:dpr});
      const page=await context.newPage();
      const errors=[],requests=[];
      page.on('pageerror',error=>errors.push(String(error)));
      page.on('console',entry=>{if(entry.type()==='error')errors.push(entry.text());});
      page.on('request',request=>{
        if(/^https?:/.test(request.url()) && new URL(request.url()).origin!==origin)requests.push(request.url());
      });
      page.on('response',response=>{if(response.status()>=400)errors.push('HTTP '+response.status()+' '+response.url());});
      await page.goto(url,{waitUntil:'load',timeout:30000});
      await page.waitForFunction(()=>window.PFX_COMPOSITION?.frames>=12||window.PFX_COMPOSITION?.errors?.length>0,null,{timeout:120000});
      const first=PNG.sync.read(await page.screenshot({path:path.join(proof,'cube-dpr'+dpr+'-initial.png'),animations:'disabled'}));
      await page.waitForFunction(()=>window.PFX_COMPOSITION?.frames>=45||window.PFX_COMPOSITION?.errors?.length>0,null,{timeout:120000});
      const state=await page.evaluate(()=>window.PFX_COMPOSITION);
      const final=PNG.sync.read(await page.screenshot({path:path.join(proof,'cube-dpr'+dpr+'-final.png'),animations:'disabled'}));
      const at=(png,x,y)=>rgba(png,x*dpr,y*dpr);
      const samples={
        background:at(final,750,100),
        white:at(final,65,27),
        magenta:at(final,100,47),
        overlap:at(final,400,225),
        cube:at(final,400,325),
        transparentSourceAlpha:state.pixelChecks?.transparent
      };
      let changed=0,geometry=0;
      const background=samples.background;
      for(let y=130;y<400;y+=3)for(let x=270;x<560;x+=3){
        const a=at(first,x,y),b=at(final,x,y);
        if(distance(a,b)>48)changed++;
        if(distance(b,background)>90 && !(b[0]>230&&b[1]>230&&b[2]>230) && !(b[0]>200&&b[1]<70&&b[2]>200))geometry++;
      }
      const render=state.renderDurationsMs.slice(10);
      const intervals=state.frameIntervalsMs.slice(10);
      const report={
        dpr,size:[final.width,final.height],state:{
          vello:state.vello,filament:state.filament,geometry:state.geometry,
          perspective:state.perspective,frames:state.frames,gpuVersion:state.gpuVersion,
          velloRenderMs:state.velloRenderMs,filamentInitMs:state.filamentInitMs
        },samplePixels:samples,changedSamplePixels:changed,nonBackgroundSamplePixels:geometry,
        renderMsP95:p95(render),frameIntervalMsP95:p95(intervals),
        networkRequestsOutsideLocalOrigin:requests,errors:[...errors,...state.errors],
        method:'Independent Filament WebGL2 canvas + Vello CPU WASM 2D canvas; browser alpha compositing, no shared GPU resources',
        performanceNote:'Software SwiftShader runner only. Observational values, not a production GPU benchmark.'
      };
      reports.push(report);
      writeFileSync(path.join(proof,'cube-dpr'+dpr+'.json'),JSON.stringify(report,null,2)+'\n');
      if(report.errors.length||requests.length||!state.vello||!state.filament||!state.perspective||state.frames<45)
        throw Error('Both source-built renderers did not complete: '+JSON.stringify(report));
      if(final.width!==800*dpr||final.height!==500*dpr)throw Error('Unexpected screenshot dimensions');
      if(samples.white.slice(0,3).some(c=>c<210))throw Error('Vello white pixels not composited');
      if(samples.magenta[0]<150||samples.magenta[2]<120||samples.magenta[1]>120)throw Error('Vello magenta not composited');
      if(samples.overlap[0]<150||samples.overlap[2]<120||samples.overlap[1]>120)
        throw Error('Vello foreground not present over central 3D viewport');
      if(samples.transparentSourceAlpha!==0)throw Error('Vello clear alpha not zero');
      if(changed<1000||geometry<400)throw Error('3D object is not visibly moving: '+JSON.stringify(report));
      await context.close();
    }
    process.stdout.write(JSON.stringify(reports,null,2)+'\n');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
