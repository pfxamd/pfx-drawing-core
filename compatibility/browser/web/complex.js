// Complex path + antialiasing proof: real source-built Vello CPU and Filament.
// Conservative dirty boxes are fixed for this scene. NOT automatic damage tracking.
const state=window.PFX_COMPLEX={
  vello:false,filament:false,perspective:false,frames:0,errors:[],
  renderDurationsMs:[],frameIntervalsMs:[],frameCpuMs:[],
  rasterCallsMs:[],rgbaCopyMs:[],putImageDataMs:[],
  rendererCounts:{full:0,union:0,tileA:0,tileB:0},rgbaTransferBytes:0,
  contextLosses:0,pixelChecks:{},gpuVersion:null,gpuRenderer:null
};
const params=new URLSearchParams(location.search);
const mode=['2d','3d','mixed'].includes(params.get('mode'))?params.get('mode'):'mixed';
const strategy=['full','union','overlap'].includes(params.get('strategy'))?params.get('strategy'):'full';
const targetFrames=Number(params.get('frames'))||160;
if(!Number.isInteger(targetFrames)||targetFrames<100||targetFrames>240)throw Error('Invalid frame count');
state.mode=mode;state.strategy=strategy;state.targetFrames=targetFrames;
const started=performance.now(),ms=n=>+n.toFixed(3);
window.addEventListener('error',event=>state.errors.push(String(event.message)));
window.addEventListener('unhandledrejection',event=>state.errors.push(String(event.reason)));
const canvas=document.querySelector('#gpu'),hud=document.querySelector('#hud');
let uploadComplex=()=>{};
if(mode!=='3d')try{
  const {
    default:initVello,render_complex_full,render_complex_union,
    render_complex_tile_a,render_complex_tile_b
  }=await import('./pfx_vello_complex.js');
  await initVello();
  const ctx=hud.getContext('2d',{willReadFrequently:true});
  const regions={
    full:{x:0,y:0,w:800,h:500,render:render_complex_full},
    union:{x:448,y:96,w:336,h:256,render:render_complex_union},
    tileA:{x:448,y:96,w:208,h:208,render:render_complex_tile_a},
    tileB:{x:592,y:144,w:192,h:208,render:render_complex_tile_b}
  };
  function put(key,frame){
    const r=regions[key],t=performance.now(),bytes=r.render(frame);
    state.rasterCallsMs.push(ms(performance.now()-t));
    state.rendererCounts[key]++;
    if(bytes.length!==r.w*r.h*4)throw Error('Wrong RGBA bytes '+key);
    const copiedAt=performance.now(),image=new ImageData(new Uint8ClampedArray(bytes),r.w,r.h);
    state.rgbaCopyMs.push(ms(performance.now()-copiedAt));
    const uploadAt=performance.now();
    ctx.putImageData(image,r.x,r.y);
    state.putImageDataMs.push(ms(performance.now()-uploadAt));
    state.rgbaTransferBytes+=bytes.length;
    state.lastFrame=frame;
  }
  // All modes use the SAME fully initialized frame-zero buffer.
  put('full',0);
  const foreground=ctx.getImageData(80,46,1,1).data;
  const clear=ctx.getImageData(400,350,1,1).data;
  if(foreground[0]<150||foreground[2]<120||foreground[1]>120||foreground[3]!==255)
    throw Error('Static paint missing');
  if(clear[3]!==0)throw Error('Expected transparent source pixel');
  state.pixelChecks={foreground:[...foreground],transparent:clear[3]};
  uploadComplex=frame=>{
    if(strategy==='full')put('full',frame);
    else if(strategy==='union')put('union',frame);
    else{put('tileA',frame);put('tileB',frame);}
  };
  window.PFX_VERIFY_COMPLEX=()=>{
    const frames=[0,43,97,159];
    let mismatchesUnion=0,mismatchesA=0,mismatchesB=0;
    let subpixelAlpha=0,overlapPainted=0,checks=0,maxDelta=0,alphaMismatches=0;
    const differences=[];
    function mismatch(full,tile,r,region,frame){
      let wrong=0;
      for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
        const a=((y+r.y)*800+x+r.x)*4,b=(y*r.w+x)*4;
        for(let c=0;c<4;c++){if(full[a+c]!==tile[b+c]){
            wrong++;
            const delta=Math.abs(full[a+c]-tile[b+c]);
            maxDelta=Math.max(delta,maxDelta);
            if(c===3)alphaMismatches++;
            if(differences.length<20)differences.push({region,frame,x:x+r.x,y:y+r.y,channel:c,full:full[a+c],tile:tile[b+c],delta});
          }
          checks++;}
      }
      return wrong;
    }
    for(const frame of frames){
      const all=render_complex_full(frame);
      mismatchesUnion+=mismatch(all,render_complex_union(frame),regions.union,'union',frame);
      mismatchesA+=mismatch(all,render_complex_tile_a(frame),regions.tileA,'tileA',frame);
      mismatchesB+=mismatch(all,render_complex_tile_b(frame),regions.tileB,'tileB',frame);
      for(let y=112;y<340;y++)for(let x=455;x<770;x++){
        const i=(y*800+x)*4;
        if(all[i+3]>0&&all[i+3]<255)subpixelAlpha++;
      }
      for(let y=144;y<304;y++)for(let x=592;x<656;x++){
        if(all[(y*800+x)*4+3]>0)overlapPainted++;
      }
    }
    const reference=render_complex_full(state.lastFrame);
    const pixels=ctx.getImageData(0,0,800,500).data;
    let mismatchesDisplayed=0,maxDisplayDelta=0;
    for(let i=0;i<reference.length;i++)if(reference[i]!==pixels[i]){
      mismatchesDisplayed++;
      maxDisplayDelta=Math.max(maxDisplayDelta,Math.abs(reference[i]-pixels[i]));
    }
    return {
      mismatchesUnion,mismatchesA,mismatchesB,mismatchesDisplayed,maxDisplayDelta,
      subpixelAlpha,overlapPainted,channelsCompared:checks,maxDelta,alphaMismatches,differences,
      lastFrame:state.lastFrame,verificationFrames:frames
    };
  };
  state.vello=true;
}catch(error){state.errors.push('VELLO: '+String(error));}

if(mode!=='2d')try {
  if(!window.Filament)throw Error('Source-built Filament runtime absent');
  Filament.init(['./triangle.filamat'],()=>{
    try {
      const engine=Filament.Engine.create(canvas);
      const scene=engine.createScene();
      const cube=Filament.EntityManager.get().create();
      scene.addEntity(cube);
      // Six differently coloured faces, true 3D coordinates and depth.
      const positions=new Float32Array([
        -1,-1,1, 1,-1,1, 1,1,1, -1,1,1,
        -1,-1,-1, -1,1,-1, 1,1,-1, 1,-1,-1,
        -1,1,-1, -1,1,1, 1,1,1, 1,1,-1,
        -1,-1,-1, 1,-1,-1, 1,-1,1, -1,-1,1,
        1,-1,-1, 1,1,-1, 1,1,1, 1,-1,1,
        -1,-1,-1, -1,-1,1, -1,1,1, -1,1,-1
      ]);
      const faceColors=[0xff4f75f3,0xff30ab72,0xfff39a45,0xffd051a0,0xfff6cc52,0xff4ccedb];
      const colors=new Uint32Array(faceColors.flatMap(c=>[c,c,c,c]));
      const indices=new Uint16Array([
        0,1,2,0,2,3,4,5,6,4,6,7,
        8,9,10,8,10,11,12,13,14,12,14,15,
        16,17,18,16,18,19,20,21,22,20,22,23
      ]);
      const vb=Filament.VertexBuffer.Builder().vertexCount(24).bufferCount(2)
        .attribute(Filament.VertexAttribute.POSITION,0,Filament.VertexBuffer$AttributeType.FLOAT3,0,12)
        .attribute(Filament.VertexAttribute.COLOR,1,Filament.VertexBuffer$AttributeType.UBYTE4,0,4)
        .normalized(Filament.VertexAttribute.COLOR).build(engine);
      vb.setBufferAt(engine,0,positions);
      vb.setBufferAt(engine,1,colors);
      const ib=Filament.IndexBuffer.Builder().indexCount(36)
        .bufferType(Filament.IndexBuffer$IndexType.USHORT).build(engine);
      ib.setBuffer(engine,indices);
      const material=engine.createMaterial('./triangle.filamat');
      Filament.RenderableManager.Builder(1)
        .boundingBox({center:[0,0,0],halfExtent:[1,1,1]})
        .material(0,material.getDefaultInstance())
        .geometry(0,Filament.RenderableManager$PrimitiveType.TRIANGLES,vb,ib)
        .build(engine,cube);
      const swapChain=engine.createSwapChain();
      const renderer=engine.createRenderer();
      const camera=engine.createCamera(Filament.EntityManager.get().create());
      const view=engine.createView();
      view.setCamera(camera);view.setScene(scene);
      view.setViewport([0,0,800,500]);
      camera.lookAt([2.2,1.9,5.0],[0,0,0],[0,1,0]);
      camera.setProjectionFov(55,800/500,0.1,30,Filament.Camera$Fov.VERTICAL);
      renderer.setClearOptions({clearColor:[0,0.1,0.2,1],clear:true});
      const gl=canvas.getContext('webgl2');
      if(!gl)throw Error('WebGL2 context missing');
      state.contextLosses=0;
      canvas.addEventListener('webglcontextlost',event=>{
        event.preventDefault();
        state.contextLosses++;
        state.errors.push('Unexpected WebGL context lost');
      });
      state.gpuVersion=gl.getParameter(gl.VERSION);
      const debug=gl.getExtension('WEBGL_debug_renderer_info');
      state.gpuRenderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null;
      state.geometry='24-vertex, 36-index cube';
      state.perspective=true;
      state.filament=true;
      state.filamentInitMs=+(performance.now()-started).toFixed(3);
      const tcm=engine.getTransformManager();
      let lastFrame=null;
      function draw(timestamp){
        try {
          if(lastFrame!==null)state.frameIntervalsMs.push(+(timestamp-lastFrame).toFixed(3));
          lastFrame=timestamp;
          const y=0.12+state.frames*0.074, x=0.25+state.frames*0.019;
          const cy=Math.cos(y),sy=Math.sin(y),cx=Math.cos(x),sx=Math.sin(x);
          const matrix=new Float32Array([
            cy,0,-sy,0, sy*sx,cx,cy*sx,0,
            sy*cx,-sx,cy*cx,0, 0,0,0,1
          ]);
          const instance=tcm.getInstance(cube);
          tcm.setTransform(instance,matrix);
          instance.delete();
          const workStart=performance.now();
          if(mode==='mixed')uploadComplex(state.frames);
          const before=performance.now();
          renderer.render(swapChain,view);
          state.renderDurationsMs.push(+(performance.now()-before).toFixed(3));
          state.frameCpuMs.push(+(performance.now()-workStart).toFixed(3));
          state.frames++;
          if(state.frames<targetFrames)requestAnimationFrame(draw);
        }catch(error){state.errors.push('FILAMENT FRAME: '+String(error));}
      }
      requestAnimationFrame(draw);
    }catch(error){state.errors.push('FILAMENT CONSTRUCTOR: '+String(error));}
  });
}catch(error){state.errors.push('FILAMENT: '+String(error));}


if(mode==='2d'){
  if(state.vello){
    let previous=null;
    function tick(timestamp){
      try{
        if(previous!==null)state.frameIntervalsMs.push(ms(timestamp-previous));
        previous=timestamp;
        const before=performance.now();
        uploadComplex(state.frames);
        state.frameCpuMs.push(ms(performance.now()-before));
        state.frames++;
        if(state.frames<targetFrames)requestAnimationFrame(tick);
      }catch(error){state.errors.push('2D FRAME: '+String(error));}
    }
    requestAnimationFrame(tick);
  }else state.errors.push('2D-only initialization failed');
}
