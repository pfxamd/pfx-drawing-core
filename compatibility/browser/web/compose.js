import initVello, {render_overlay} from './pfx_vello_overlay.js';

window.PFX_COMPOSITION = {vello:false,filament:false,frames:0,errors:[],pixelChecks:{}};
window.addEventListener('error', e=>window.PFX_COMPOSITION.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e=>window.PFX_COMPOSITION.errors.push(String(e.reason)));

const canvas=document.querySelector('#gpu');
const hud=document.querySelector('#hud');

try {
  await initVello();
  const result=render_overlay(800,500);
  if(result.length!==800*500*4)throw new Error('Unexpected Vello buffer size');
  const ctx=hud.getContext('2d',{willReadFrequently:true});
  ctx.putImageData(new ImageData(new Uint8ClampedArray(result),800,500),0,0);
  const fill=ctx.getImageData(40,26,1,1).data;
  const clear=ctx.getImageData(400,250,1,1).data;
  if(fill[3]!==255||clear[3]!==0)throw new Error('Vello overlay RGBA assertion failed');
  window.PFX_COMPOSITION.vello=true;
  window.PFX_COMPOSITION.pixelChecks={opaque:fill[3],transparent:clear[3]};
} catch(error) {
  window.PFX_COMPOSITION.errors.push('VELLO: '+String(error));
}

try {
  if(!window.Filament)throw new Error('Filament source-built browser runtime absent');
  Filament.init(['./triangle.filamat'],()=>{
    try{
      const engine=Filament.Engine.create(canvas);
      const scene=engine.createScene();
      const triangle=Filament.EntityManager.get().create();
      scene.addEntity(triangle);
      const positions=new Float32Array([0.0,0.82,-0.85,-0.65,0.85,-0.65]);
      const colors=new Uint32Array([0xff0066ff,0xff00ff77,0xffff3355]);
      const vb=Filament.VertexBuffer.Builder()
        .vertexCount(3).bufferCount(2)
        .attribute(Filament.VertexAttribute.POSITION,0,Filament.VertexBuffer$AttributeType.FLOAT2,0,8)
        .attribute(Filament.VertexAttribute.COLOR,1,Filament.VertexBuffer$AttributeType.UBYTE4,0,4)
        .normalized(Filament.VertexAttribute.COLOR).build(engine);
      vb.setBufferAt(engine,0,positions);
      vb.setBufferAt(engine,1,colors);
      const ib=Filament.IndexBuffer.Builder().indexCount(3)
        .bufferType(Filament.IndexBuffer$IndexType.USHORT).build(engine);
      ib.setBuffer(engine,new Uint16Array([0,1,2]));
      const material=engine.createMaterial('./triangle.filamat');
      const entityMaterial=material.getDefaultInstance();
      Filament.RenderableManager.Builder(1)
        .boundingBox({center:[0,0,0],halfExtent:[1,1,1]})
        .material(0,entityMaterial)
        .geometry(0,Filament.RenderableManager$PrimitiveType.TRIANGLES,vb,ib)
        .build(engine,triangle);
      const swapChain=engine.createSwapChain();
      const renderer=engine.createRenderer();
      const camera=engine.createCamera(Filament.EntityManager.get().create());
      const view=engine.createView();
      view.setCamera(camera);
      view.setScene(scene);
      view.setViewport([0,0,800,500]);
      camera.setProjection(Filament.Camera$Projection.ORTHO,-1.6,1.6,-1,1,0,1);
      renderer.setClearOptions({clearColor:[0.0,0.1,0.2,1.0],clear:true});
      const gl=canvas.getContext('webgl2');
      if(!gl) throw new Error('WebGL2 context missing');
      window.PFX_COMPOSITION.gpuVersion=gl.getParameter(gl.VERSION);
      window.PFX_COMPOSITION.filament=true;
      function draw(){
        renderer.render(swapChain,view);
        window.PFX_COMPOSITION.frames++;
        if(window.PFX_COMPOSITION.frames<140)
          requestAnimationFrame(draw);
      }
      requestAnimationFrame(draw);
    }catch(e){window.PFX_COMPOSITION.errors.push('FILAMENT CONSTRUCTOR: '+String(e));}
  });
}catch(error){window.PFX_COMPOSITION.errors.push('FILAMENT: '+String(error));}
