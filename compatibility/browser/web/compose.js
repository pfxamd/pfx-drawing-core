import initVello, {render_overlay} from './pfx_vello_overlay.js';

// A compatibility experiment, not the PFx renderer or a shared GPU context.
const state=window.PFX_COMPOSITION={
  vello:false,filament:false,frames:0,errors:[],pixelChecks:{},
  geometry:null,perspective:false,velloRenderMs:null,filamentInitMs:null,
  renderDurationsMs:[],frameIntervalsMs:[],gpuVersion:null
};
const started=performance.now();
window.addEventListener('error',e=>state.errors.push(String(e.message)));
window.addEventListener('unhandledrejection',e=>state.errors.push(String(e.reason)));
const canvas=document.querySelector('#gpu');
const hud=document.querySelector('#hud');

try {
  await initVello();
  const begin=performance.now();
  const pixels=render_overlay(800,500);
  state.velloRenderMs=+(performance.now()-begin).toFixed(3);
  if(pixels.length!==800*500*4)throw Error('Unexpected Vello RGBA buffer size');
  const context=hud.getContext('2d',{willReadFrequently:true});
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels),800,500),0,0);
  const fill=context.getImageData(40,26,1,1).data;
  const clear=context.getImageData(400,350,1,1).data;
  if(fill[3]!==255||clear[3]!==0)throw Error('Vello RGBA alpha assertions failed');
  // Reuse actual Vello-drawn pixels to cover part of the 3D object.
  // drawImage preserves transparent source pixels in this separate 2D canvas.
  context.drawImage(hud,0,18,225,120,300,196,225,120);
  const overlap=context.getImageData(400,225,1,1).data;
  if(overlap[0]<150||overlap[2]<150||overlap[1]>120||overlap[3]!==255)
    throw Error('Vello composited foreground missing');
  state.vello=true;
  state.pixelChecks={opaque:fill[3],transparent:clear[3],overlap:[...overlap]};
} catch(error){state.errors.push('VELLO: '+String(error));}

try {
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
      state.gpuVersion=gl.getParameter(gl.VERSION);
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
          const before=performance.now();
          renderer.render(swapChain,view);
          state.renderDurationsMs.push(+(performance.now()-before).toFixed(3));
          state.frames++;
          if(state.frames<100)requestAnimationFrame(draw);
        }catch(error){state.errors.push('FILAMENT FRAME: '+String(error));}
      }
      requestAnimationFrame(draw);
    }catch(error){state.errors.push('FILAMENT CONSTRUCTOR: '+String(error));}
  });
}catch(error){state.errors.push('FILAMENT: '+String(error));}
