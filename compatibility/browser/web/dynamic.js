// Experimental moving Vello CPU-WASM pixels over Filament WebGL2.
// Distinct Canvas2D and WebGL2 canvases; no shared GPU resources.
const state=window.PFX_DYNAMIC={
  vello:false,filament:false,perspective:false,frames:0,errors:[],
  renderDurationsMs:[],frameIntervalsMs:[],frameCpuMs:[],
  velloRasterMs:[],rgbaCopyMs:[],putImageDataMs:[],canvasCompositeMs:[],
  overlayUpdates:0,velloCalls:0,putImageDataCalls:0,totalRgbaTransferBytes:0,
  contextLosses:0,pixelChecks:{},gpuVersion:null,gpuRenderer:null
};
const params=new URLSearchParams(location.search);
const mode=['2d','3d','mixed'].includes(params.get('mode'))?params.get('mode'):'mixed';
const strategy=['static','cache','reraster'].includes(params.get('strategy'))?params.get('strategy'):'static';
const targetFrames=Number(params.get('frames'))||180;
if(!Number.isInteger(targetFrames)||targetFrames<100||targetFrames>360)throw Error('Frame target outside experiment bounds');
state.mode=mode;state.strategy=strategy;state.targetFrames=targetFrames;
const started=performance.now(),ms=n=>+n.toFixed(3);
window.addEventListener('error',event=>state.errors.push(String(event.message)));
window.addEventListener('unhandledrejection',event=>state.errors.push(String(event.reason)));
const canvas=document.querySelector('#gpu'),hud=document.querySelector('#hud');
let updateOverlay=()=>{};
if(mode!=='3d')try{
  const {default:initVello,render_overlay}=await import('./pfx_vello_overlay.js');
  await initVello();
  const display=hud.getContext('2d',{willReadFrequently:true});
  const source=document.createElement('canvas');
  source.width=800;source.height=500;
  const sourceContext=source.getContext('2d',{willReadFrequently:false});
  function refreshSource(){
    const start=performance.now();
    const pixels=render_overlay(800,500);
    state.velloRasterMs.push(ms(performance.now()-start));
    state.velloCalls++;
    if(pixels.length!==800*500*4)throw Error('Vello pixel buffer mismatch');
    const copyStart=performance.now();
    const data=new Uint8ClampedArray(pixels);
    const image=new ImageData(data,800,500);
    state.rgbaCopyMs.push(ms(performance.now()-copyStart));
    const uploadStart=performance.now();
    sourceContext.putImageData(image,0,0);
    state.putImageDataMs.push(ms(performance.now()-uploadStart));
    state.putImageDataCalls++;
    state.totalRgbaTransferBytes+=data.byteLength;
  }
  refreshSource();
  const original=sourceContext.getImageData(40,26,1,1).data;
  const clear=sourceContext.getImageData(400,350,1,1).data;
  if(original[3]!==255||clear[3]!==0)throw Error('Vello alpha test failed');
  state.pixelChecks={opaque:original[3],transparent:clear[3]};
  updateOverlay=(frame)=>{
    if(strategy==='reraster'&&frame>=0)refreshSource();
    // Source geometry remains static. Movement is a Canvas2D translation.
    const x=strategy==='static'?0:Math.round(45*Math.sin(frame*0.081));
    const y=strategy==='static'?0:Math.round(9*Math.cos(frame*0.067));
    const paint=performance.now();
    display.clearRect(0,0,800,500);
    display.drawImage(source,x,y);
    display.drawImage(source,0,18,225,120,300+x,196+y,225,120);
    state.canvasCompositeMs.push(ms(performance.now()-paint));
    state.overlayUpdates++;
    state.lastTranslation=[x,y];
  };
  // Baseline draws once; animated strategies refresh on every RAF thereafter.
  if(strategy==='reraster'){
    const p=state.velloCalls;
    // Avoid a redundant second rasterization before the first animation callback.
    const x=0,y=0;
    display.drawImage(source,x,y);
    display.drawImage(source,0,18,225,120,300,196,225,120);
    state.overlayUpdates++;
  }else updateOverlay(0);
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
          if(mode==='mixed'&&strategy!=='static')updateOverlay(state.frames);
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
        if(strategy!=='static')updateOverlay(state.frames);
        state.frameCpuMs.push(ms(performance.now()-before));
        state.frames++;
        if(state.frames<targetFrames)requestAnimationFrame(tick);
      }catch(error){state.errors.push('2D FRAME: '+String(error));}
    }
    requestAnimationFrame(tick);
  }else state.errors.push('2D-only initialization failed');
}
