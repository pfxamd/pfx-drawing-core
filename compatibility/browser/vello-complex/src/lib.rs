// MIT OR Apache-2.0 — PFx proof only, built against pinned source Vello CPU.
// Conservative manually specified dirty rectangles; no GPU-sharing claims.
use wasm_bindgen::prelude::*;
use vello_cpu::{RenderContext, Resources, Pixmap, RasterizerSettings, RenderMode};
use vello_cpu::{color::palette::css, kurbo::{Affine, BezPath, Rect, Stroke}};

const FULL_W: u16 = 800;
const FULL_H: u16 = 500;
const A_X: u16 = 448;
const A_Y: u16 = 96;
const A_W: u16 = 208;
const A_H: u16 = 208;
const B_X: u16 = 592;
const B_Y: u16 = 144;
const B_W: u16 = 192;
const B_H: u16 = 208;
const UNION_X: u16 = A_X;
const UNION_Y: u16 = A_Y;
const UNION_W: u16 = 336;
const UNION_H: u16 = 256;

fn rect(ctx: &mut RenderContext, x: f64, y: f64, w: f64, h: f64, _ox: f64, _oy: f64) {
    ctx.fill_rect(&Rect::new(x, y, x + w, y + h));
}

fn blob_a(ctx: &mut RenderContext, t: f64, _ox: f64, _oy: f64, draw_inset: bool) {
    let x = 480.45 + 12.0 * (t * 0.061).sin();
    let y = 145.15 + 7.0 * (t * 0.037).cos();
    let mut p = BezPath::new();
    p.move_to((x, y + 55.0));
    p.curve_to((x - 10.15, y + 5.25), (x + 78.75, y - 28.65), (x + 112.35, y + 15.55));
    p.curve_to((x + 157.45, y + 64.05), (x + 88.85, y + 118.25), (x + 28.2, y + 100.3));
    p.quad_to((x - 15.65, y + 85.45), (x, y + 55.0));
    p.close_path();
    ctx.set_paint(css::MAGENTA);
    ctx.fill_path(&p);
    if !draw_inset { return; }
    // A separate, overlapping inset with its own fractional antialiased boundary.
    let mut inset = BezPath::new();
    inset.move_to((x + 39.5, y + 53.5));
    inset.curve_to((x + 68.5, y + 16.45), (x + 115.5, y + 57.5), (x + 86.5, y + 76.5));
    inset.quad_to((x + 54.5, y + 102.5), (x + 39.5, y + 53.5));
    inset.close_path();
    ctx.set_paint(css::WHITE);
    ctx.fill_path(&inset);
}

fn blob_b(ctx: &mut RenderContext, t: f64, _ox: f64, _oy: f64, draw_inset: bool) {
    let x = 608.65 + 14.0 * (t * 0.073).cos();
    let y = 202.35 + 9.0 * (t * 0.047).sin();
    let mut p = BezPath::new();
    p.move_to((x - 16.75, y + 53.25));
    p.curve_to((x - 24.15, y - 4.65), (x + 80.65, y - 32.25), (x + 109.5, y + 25.75));
    p.curve_to((x + 151.45, y + 80.25), (x + 82.25, y + 131.2), (x + 18.05, y + 109.5));
    p.quad_to((x - 23.25, y + 96.85), (x - 16.75, y + 53.25));
    p.close_path();
    ctx.set_paint(css::WHITE);
    ctx.fill_path(&p);

    if !draw_inset { return; }
    let mut overlap = BezPath::new();
    overlap.move_to((x + 11.4, y + 47.15));
    overlap.curve_to((x + 37.5, y + 10.75), (x + 96.5, y + 29.85), (x + 93.25, y + 78.4));
    overlap.curve_to((x + 67.45, y + 109.85), (x + 27.5, y + 96.6), (x + 11.4, y + 47.15));
    overlap.close_path();
    ctx.set_paint(css::MAGENTA);
    ctx.fill_path(&overlap);
}

// An instrumented entrypoint with arbitrary raster origins and a global scene transform.
 // Keep the production experiment's original entrypoints bit-for-bit comparable.
fn render_variant_trace(
    step: u32, ox: u16, oy: u16, width: u16, height: u16,
    zoom: f64, rotation: f64, dx: f64, dy: f64, premultiplied: bool,
    scene: u8, quality: bool,
) -> Vec<u8> {
    if width == 0 || height == 0 ||
       u32::from(ox) + u32::from(width) > u32::from(FULL_W) ||
       u32::from(oy) + u32::from(height) > u32::from(FULL_H) ||
       !zoom.is_finite() || zoom <= 0.0 || !rotation.is_finite() ||
       !dx.is_finite() || !dy.is_finite() { return Vec::new(); }
    let mut ctx = RenderContext::new(width, height);
    let mut res = Resources::new();
    let (ox, oy) = (f64::from(ox), f64::from(oy));
    // Preserve globally identical cubic/quad path coordinates. The renderer
    // applies a translation to each tile, instead of JS/Rust rebuilding
    // differently-rounded local path control points.
    let mut scene_transform = Affine::translate((-ox, -oy));
    if zoom != 1.0 || rotation != 0.0 || dx != 0.0 || dy != 0.0 {
        // Apply geometry transformation in global scene coordinates first.
        // The raster's independent tile origin is always the outer translation.
        scene_transform = scene_transform
            * Affine::translate((620.0 + dx, 220.0 + dy))
            * Affine::rotate(rotation)
            * Affine::scale(zoom)
            * Affine::translate((-620.0, -220.0));
    }
    ctx.set_transform(scene_transform);
    // Scene flags: 1=static bars; 2=blob A including inset; 4=blob B including inset;
    // 8=blob A outline only; 16=blob B outline only.
    // Scene 7 exactly preserves the original proof workload.
    if scene & 1 != 0 {
    ctx.set_paint(css::WHITE);
    rect(&mut ctx, 24.0, 24.0, 231.0, 7.0, ox, oy);
    rect(&mut ctx, 24.0, 24.0, 7.0, 108.0, ox, oy);
    rect(&mut ctx, 615.0, 469.0, 161.0, 7.0, ox, oy);
    ctx.set_paint(css::MAGENTA);
    rect(&mut ctx, 24.0, 44.0, 156.0, 11.0, ox, oy);
    rect(&mut ctx, 24.0, 452.0, 162.0, 8.0, ox, oy);
    rect(&mut ctx, 300.0, 212.0, 190.0, 12.0, ox, oy);
    }
    // Fractional Bezier contours, independent motion, blended overlaps and AA.
    let t = f64::from(step);
    if scene & 2 != 0 { blob_a(&mut ctx, t, ox, oy, true); }
    if scene & 4 != 0 { blob_b(&mut ctx, t, ox, oy, true); }
    if scene & 8 != 0 { blob_a(&mut ctx, t, ox, oy, false); }
    if scene & 16 != 0 { blob_b(&mut ctx, t, ox, oy, false); }

    let mut target = Pixmap::new(width, height);
    ctx.flush();
    if quality {
        ctx.render_with(&mut target, &mut res, RasterizerSettings {
            render_mode: RenderMode::OptimizeQuality,
            ..RasterizerSettings::default()
        });
    } else {
        ctx.render(&mut target, &mut res);
    }
    let mut result = Vec::with_capacity(usize::from(width) * usize::from(height) * 4);
    for px in target.data() {
        let (r, g, b) = if premultiplied {
            (px.r, px.g, px.b)
        } else if px.a == 0 {
            (0, 0, 0)
        } else {
            let a = u32::from(px.a);
            let straight = |value: u8| ((u32::from(value) * 255 + a / 2) / a).min(255) as u8;
            (straight(px.r), straight(px.g), straight(px.b))
        };
        result.extend_from_slice(&[r, g, b, px.a]);
    }
    result
}

fn render_variant(
    step: u32, ox: u16, oy: u16, width: u16, height: u16,
    zoom: f64, rotation: f64, dx: f64, dy: f64, premultiplied: bool,
) -> Vec<u8> {
    render_variant_trace(step, ox, oy, width, height, zoom, rotation, dx, dy,
        premultiplied, 7, false)
}

fn render(step: u32, ox: u16, oy: u16, width: u16, height: u16) -> Vec<u8> {
    render_variant(step, ox, oy, width, height, 1.0, 0.0, 0.0, 0.0, false)
}

// Pixel diagnostic: raw Vello premultiplied RGBA versus its exported
// straight-alpha conversion, evaluated with the exact same global transforms.
// The caller crops padded outputs back to its requested dirty region.
#[wasm_bindgen]
pub fn render_complex_probe(
    frame: u32, ox: u16, oy: u16, width: u16, height: u16,
    zoom: f64, rotation: f64, dx: f64, dy: f64, premultiplied: bool
) -> Vec<u8> {
    render_variant(frame, ox, oy, width, height, zoom, rotation, dx, dy, premultiplied)
}

// Isolates AA coverage vs paint composition, without changing legacy exports.
// The high-quality pipeline uses f32 for color composition, not f64 path geometry.
#[wasm_bindgen]
pub fn render_complex_origin_trace(
    frame: u32, ox: u16, oy: u16, width: u16, height: u16,
    zoom: f64, rotation: f64, dx: f64, dy: f64,
    premultiplied: bool, scene: u8, quality: bool
) -> Vec<u8> {
    render_variant_trace(frame, ox, oy, width, height,
        zoom, rotation, dx, dy, premultiplied, scene, quality)
}

#[wasm_bindgen]
pub fn render_complex_full(frame: u32) -> Vec<u8> {
    render(frame, 0, 0, FULL_W, FULL_H)
}

#[wasm_bindgen]
pub fn render_complex_union(frame: u32) -> Vec<u8> {
    render(frame, UNION_X, UNION_Y, UNION_W, UNION_H)
}

#[wasm_bindgen]
pub fn render_complex_tile_a(frame: u32) -> Vec<u8> {
    render(frame, A_X, A_Y, A_W, A_H)
}

#[wasm_bindgen]
pub fn render_complex_tile_b(frame: u32) -> Vec<u8> {
    render(frame, B_X, B_Y, B_W, B_H)
}

// Source-patched Vello intermediate diagnostics. The capture gate is active
// only for this explicit proof; all existing rendering exports remain unchanged.
#[wasm_bindgen]
pub fn render_complex_intermediate(
    frame: u32, ox: u16, oy: u16, width: u16, height: u16, scene: u8
) -> Vec<u8> {
    vello_common::pfx_trace::begin(ox, oy);
    let pixels=render_variant_trace(frame,ox,oy,width,height,
        1.0,0.0,0.0,0.0,true,scene,false);
    vello_common::pfx_trace::end();
    pixels
}
// Canonical mode is a controlled alternative; trace collection is optional so
// the rendering cost can be benchmarked without trace-buffer overhead.
#[wasm_bindgen]
pub fn render_complex_canonical(
    frame:u32, ox:u16, oy:u16, width:u16, height:u16,
    scene:u8, canonical:bool, trace:bool
) -> Vec<u8> {
    vello_common::pfx_trace::begin_mode(ox,oy,canonical,trace);
    let rgba=render_variant_trace(frame,ox,oy,width,height,
        1.0,0.0,0.0,0.0,true,scene,false);
    vello_common::pfx_trace::end();
    rgba
}

#[wasm_bindgen]
pub fn intermediate_lines() -> Vec<f32> {
    vello_common::pfx_trace::lines()
}
#[wasm_bindgen]
pub fn intermediate_coverages() -> Vec<f32> {
    vello_common::pfx_trace::pixels()
}
#[wasm_bindgen]
pub fn intermediate_truncated() -> bool {
    vello_common::pfx_trace::truncated()
}

// Extended diagnostic only. Scene flags: 1 = filled Bézier paths,
// 2 = stroked Bézier path, 4 = freeform clip, 8 = secondary nested clip,
// 16 = offscreen geometry that crosses full-scene boundaries. No feature is
// enabled without a selected flag. All global geometry is identical between
// full and independent dirty subregion rendering.
#[wasm_bindgen]
pub fn render_complex_extended(
    canvas_width:u16, canvas_height:u16, frame:u32,
    ox:u16, oy:u16, width:u16, height:u16,
    scene:u8, zoom:f64, rotation:f64, dx:f64, dy:f64,
    canonical:bool
) -> Vec<u8> {
    if canvas_width==0 || canvas_height==0 || width==0 || height==0 ||
        (u32::from(ox)+u32::from(width)>u32::from(canvas_width)) ||
        (u32::from(oy)+u32::from(height)>u32::from(canvas_height)) ||
        !zoom.is_finite() || !(0.5..=2.0).contains(&zoom) ||
        !rotation.is_finite() || !dx.is_finite() || !dy.is_finite() ||
        scene & !31 != 0 || (scene & 19)==0 {
        return Vec::new();
    }
    vello_common::pfx_trace::begin_extended(
        ox,oy,canvas_width,canvas_height,canonical,false
    );
    let mut ctx=RenderContext::new(width,height);
    let mut res=Resources::new();
    let transform=Affine::translate((-f64::from(ox),-f64::from(oy)))
        * Affine::translate((620.0+dx,240.0+dy))
        * Affine::rotate(rotation)
        * Affine::scale(zoom)
        * Affine::translate((-620.0,-240.0));
    ctx.set_transform(transform);
    if scene & 4 != 0 {
        let mut clip=BezPath::new();
        clip.move_to((424.45,186.35));
        clip.curve_to((445.2,123.15),(705.75,120.25),(773.65,188.85));
        clip.curve_to((808.5,310.45),(663.5,362.75),(460.25,355.15));
        clip.quad_to((411.2,312.25),(424.45,186.35));
        clip.close_path();
        ctx.push_clip_path(&clip);
    }
    if scene & 8 != 0 {
        // A second independent path clip nested inside the first. Fractional
        // edges intersect curved source geometry at non-tile-aligned pixels.
        let mut inner=BezPath::new();
        inner.move_to((478.875,147.375));
        inner.curve_to((542.625,112.875),(737.125,172.625),(746.375,231.125));
        inner.curve_to((764.625,318.875),(626.125,359.375),(509.625,309.125));
        inner.quad_to((456.375,241.625),(478.875,147.375));
        inner.close_path();
        ctx.push_clip_path(&inner);
    }
    if scene & 1 != 0 {
        let t=f64::from(frame);
        blob_a(&mut ctx,t,0.0,0.0,true);
        blob_b(&mut ctx,t,0.0,0.0,true);
    }
    if scene & 2 != 0 {
        let mut p=BezPath::new();
        p.move_to((421.45,263.25));
        p.curve_to((490.15,165.45),(590.25,355.65),(678.55,211.45));
        p.quad_to((741.15,161.25),(788.75,320.35));
        ctx.set_stroke(Stroke::new(12.25));
        ctx.set_paint(css::MAGENTA);
        ctx.stroke_path(&p);
    }
    if scene & 16 != 0 {
        // The input path is larger than the entire canvas, with segments
        // on both sides of its boundaries. Tile-first clipping and winding
        // handling can change when the path's visible intersection is small.
        let cw=f64::from(canvas_width);
        let ch=f64::from(canvas_height);
        let mut spanning=BezPath::new();
        spanning.move_to((-163.375, ch * 0.285));
        spanning.curve_to((-115.625,-88.375),(cw * 0.64, -76.625),(cw+137.125,ch*0.33));
        spanning.curve_to((cw+196.875,ch*0.88),(cw*0.78,ch+120.375),(-69.125,ch+86.875));
        spanning.curve_to((-194.375,ch*0.77),(-152.125,ch*0.47),(-163.375,ch*0.285));
        spanning.close_path();
        ctx.set_paint(css::MAGENTA);
        ctx.fill_path(&spanning);
        // A second contour crossing the right edge and canvas bottom.
        let mut rim=BezPath::new();
        rim.move_to((cw*0.56,-111.125));
        rim.curve_to((cw+86.875,24.625),(cw+151.125,ch*0.79),(cw*0.72,ch+93.375));
        rim.quad_to((cw*0.48,ch*0.66),(cw*0.56,-111.125));
        rim.close_path();
        ctx.set_paint(css::WHITE);
        ctx.fill_path(&rim);
    }
    if scene & 8 != 0 {ctx.pop_clip();}
    if scene & 4 != 0 {ctx.pop_clip();}
    ctx.flush();
    let mut target=Pixmap::new(width,height);
    ctx.render(&mut target,&mut res);
    let mut data=Vec::with_capacity(usize::from(width)*usize::from(height)*4);
    for px in target.data(){
        data.extend_from_slice(&[px.r,px.g,px.b,px.a]);
    }
    vello_common::pfx_trace::end();
    data
}

// Layered color-compositing and dirty repaint proof only. Pinned-source Vello
// CPU WASM: the same compositing stack is independently rerendered both in
// full frame and tile frame. Mode 0=normal, 1=multiply, 2=screen,
// 3=overlay, 4=masked layered blend. No physical GPU claim.
#[wasm_bindgen]
pub fn render_complex_layered(
    canvas_width:u16, canvas_height:u16, frame:u32,
    ox:u16, oy:u16, width:u16, height:u16,
    mode:u8, canonical:bool
) -> Vec<u8> {
    if canvas_width==0 || canvas_height==0 || width==0 || height==0
        || u32::from(ox)+u32::from(width)>u32::from(canvas_width)
        || u32::from(oy)+u32::from(height)>u32::from(canvas_height)
        || mode>4 { return Vec::new(); }
    use vello_cpu::peniko::{BlendMode, Mix, Compose};
    vello_common::pfx_trace::begin_extended(
        ox,oy,canvas_width,canvas_height,canonical,false
    );
    let mut ctx=RenderContext::new(width,height);
    let mut res=Resources::new();
    ctx.set_transform(Affine::translate((-f64::from(ox),-f64::from(oy))));
    // Nonempty stable backdrop, but NOT a full opaque canvas clear.
    ctx.set_paint(css::WHITE);
    ctx.fill_rect(&Rect::new(350.0,70.0,790.0,412.0));
    ctx.set_paint(css::MAGENTA);
    ctx.fill_rect(&Rect::new(395.0,122.0,765.0,375.0));
    let t=f64::from(frame);
    let x=480.45+12.0*(t*0.061).sin();
    let y=145.15+7.0*(t*0.037).cos();
    let mut a=BezPath::new();
    a.move_to((x,y+55.0));
    a.curve_to((x-10.15,y+5.25),(x+78.75,y-28.65),(x+112.35,y+15.55));
    a.curve_to((x+157.45,y+64.05),(x+88.85,y+118.25),(x+28.2,y+100.3));
    a.quad_to((x-15.65,y+85.45),(x,y+55.0));
    a.close_path();

    let bx=608.65+14.0*(t*0.073).cos();
    let by=202.35+9.0*(t*0.047).sin();
    let mut b=BezPath::new();
    b.move_to((bx-16.75,by+53.25));
    b.curve_to((bx-24.15,by-4.65),(bx+80.65,by-32.25),(bx+109.5,by+25.75));
    b.curve_to((bx+151.45,by+80.25),(bx+82.25,by+131.2),(bx+18.05,by+109.5));
    b.quad_to((bx-23.25,by+96.85),(bx-16.75,by+53.25));
    b.close_path();

    // Render parent/group opacity separately from paint alpha; this tests the
    // actual Vello layer buffer including its origin-dependent isolation.
    ctx.push_opacity_layer(0.71);
    ctx.set_paint(css::WHITE);
    ctx.fill_path(&a);

    let mix=match mode {
        1=>Mix::Multiply, 2=>Mix::Screen, 3=>Mix::Overlay,
        4=>Mix::Multiply, _=>Mix::Normal,
    };
    ctx.push_blend_layer(BlendMode { mix, compose:Compose::SrcOver });
    ctx.push_opacity_layer(0.59);
    if mode==4 {
        let mut clip=BezPath::new();
        clip.move_to((438.375,174.125));
        clip.curve_to((498.625,102.375),(727.625,138.125),(771.875,240.375));
        clip.curve_to((800.125,345.375),(606.375,387.125),(455.625,304.875));
        clip.quad_to((411.375,248.625),(438.375,174.125));
        clip.close_path();
        ctx.push_clip_path(&clip);
    }
    ctx.set_paint(css::MAGENTA);
    ctx.fill_path(&b);
    ctx.set_stroke(Stroke::new(9.375));
    ctx.set_paint(css::WHITE);
    let mut line=BezPath::new();
    line.move_to((438.125,309.375));
    line.curve_to((492.625,182.125),(647.375,392.875),(753.875,214.625));
    ctx.stroke_path(&line);
    if mode==4 {ctx.pop_clip();}
    ctx.pop_layer(); // opacity 0.59
    ctx.pop_layer(); // blend mode
    ctx.pop_layer(); // parent opacity 0.71

    // A late top-level stroke exposes compositing interactions with grouped
    // alpha, especially when it crosses the moving geometry.
    ctx.set_paint(css::WHITE);
    ctx.set_stroke(Stroke::new(4.375));
    let mut top=BezPath::new();
    top.move_to((420.125,365.75));
    top.quad_to((607.625,296.875),(767.375,400.125));
    ctx.stroke_path(&top);
    ctx.flush();
    let mut target=Pixmap::new(width,height);
    ctx.render(&mut target,&mut res);
    let mut data=Vec::with_capacity(usize::from(width)*usize::from(height)*4);
    for px in target.data(){data.extend_from_slice(&[px.r,px.g,px.b,px.a]);}
    vello_common::pfx_trace::end();
    data
}


// Diagnostic command stream for testing operation-derived dirty invalidation.
// Every command carries [id, kind, dx, dy, opacity, blend, clip]. The SAME
// supplied command array drives the full render and independently rendered tiles.
// The browser computes damage from these commands, not from reference pixels.
#[wasm_bindgen]
pub fn render_complex_operations(
    full_width:u16, full_height:u16,
    ox:u16, oy:u16, width:u16, height:u16,
    commands:Vec<f64>, canonical:bool
) -> Vec<u8> {
    if full_width==0 || full_height==0 || width==0 || height==0
        || u32::from(ox)+u32::from(width)>u32::from(full_width)
        || u32::from(oy)+u32::from(height)>u32::from(full_height)
        || commands.len()%7!=0 || commands.len()>224 {
        return Vec::new();
    }
    for entry in commands.chunks_exact(7) {
        if entry.iter().any(|v| !v.is_finite())
            || entry[0].fract()!=0.0 || entry[0]<0.0
            || entry[1].fract()!=0.0 || !(1.0..=3.0).contains(&entry[1])
            || entry[4]<0.0 || entry[4]>1.0
            || entry[5].fract()!=0.0 || !(0.0..=3.0).contains(&entry[5])
            || entry[6].fract()!=0.0 || !(0.0..=1.0).contains(&entry[6])
        {return Vec::new();}
    }
    use vello_cpu::peniko::{BlendMode, Mix, Compose};
    vello_common::pfx_trace::begin_extended(
        ox,oy,full_width,full_height,canonical,false
    );
    let mut ctx=RenderContext::new(width,height);
    let mut res=Resources::new();
    let local=Affine::translate((-f64::from(ox),-f64::from(oy)));
    ctx.set_transform(local);
    ctx.set_paint(css::WHITE);
    ctx.fill_rect(&Rect::new(40.0,30.0,
        f64::from(full_width)-24.0,f64::from(full_height)-16.0));
    ctx.set_paint(css::MAGENTA);
    ctx.fill_rect(&Rect::new(245.0,231.0,738.0,241.0));
    for entry in commands.chunks_exact(7) {
        let kind=entry[1] as u8;
        ctx.set_transform(local * Affine::translate((entry[2],entry[3])));
        let mix=match entry[5] as u8 {
            1=>Mix::Multiply,2=>Mix::Screen,3=>Mix::Overlay,_=>Mix::Normal
        };
        ctx.push_blend_layer(BlendMode { mix,compose:Compose::SrcOver });
        ctx.push_opacity_layer(entry[4] as f32);
        if entry[6]!=0.0 {
            let mut clip=BezPath::new();
            match kind {
                1=>{
                    clip.move_to((470.375,130.125));
                    clip.curve_to((510.625,86.375),(646.125,164.875),(640.375,226.125));
                    clip.quad_to((568.625,277.375),(470.375,130.125));
                },
                2=>{
                    clip.move_to((595.125,186.875));
                    clip.curve_to((674.375,128.125),(774.625,237.875),(768.875,287.375));
                    clip.quad_to((666.125,373.125),(595.125,186.875));
                },
                _=>{
                    clip.move_to((174.375,292.625));
                    clip.curve_to((217.625,232.375),(369.125,302.875),(368.375,389.625));
                    clip.quad_to((253.625,442.125),(174.375,292.625));
                }
            }
            clip.close_path();
            ctx.push_clip_path(&clip);
        }
        match kind {
            1=>{
                let (x,y)=(480.45,145.15);
                let mut p=BezPath::new();
                p.move_to((x,y+55.0));
                p.curve_to((x-10.15,y+5.25),(x+78.75,y-28.65),(x+112.35,y+15.55));
                p.curve_to((x+157.45,y+64.05),(x+88.85,y+118.25),(x+28.2,y+100.3));
                p.quad_to((x-15.65,y+85.45),(x,y+55.0));
                p.close_path();
                ctx.set_paint(css::MAGENTA);
                ctx.fill_path(&p);
            },
            2=>{
                let (x,y)=(608.65,202.35);
                let mut p=BezPath::new();
                p.move_to((x-16.75,y+53.25));
                p.curve_to((x-24.15,y-4.65),(x+80.65,y-32.25),(x+109.5,y+25.75));
                p.curve_to((x+151.45,y+80.25),(x+82.25,y+131.2),(x+18.05,y+109.5));
                p.quad_to((x-23.25,y+96.85),(x-16.75,y+53.25));
                p.close_path();
                ctx.set_paint(css::MAGENTA);
                ctx.fill_path(&p);
            },
            _=>{
                let mut p=BezPath::new();
                p.move_to((182.125,326.375));
                p.curve_to((208.625,271.125),(306.375,428.625),(366.125,343.375));
                p.quad_to((321.875,258.625),(182.125,326.375));
                ctx.set_stroke(Stroke::new(13.25));
                ctx.set_paint(css::MAGENTA);
                ctx.stroke_path(&p);
            }
        }
        if entry[6]!=0.0 {ctx.pop_clip();}
        ctx.pop_layer(); // independent source opacity
        ctx.pop_layer(); // blend group
    }
    ctx.flush();
    let mut target=Pixmap::new(width,height);
    ctx.render(&mut target,&mut res);
    let mut bytes=Vec::with_capacity(usize::from(width)*usize::from(height)*4);
    for px in target.data(){bytes.extend_from_slice(&[px.r,px.g,px.b,px.a]);}
    vello_common::pfx_trace::end();
    bytes
}

// Experimental typed scene graph with arbitrary Bézier move/line/quad/cubic
// command coordinates. Node transforms, nested opacity, mix and group clipping
// come from the SAME command stream for full- and tile-frame renders.
#[wasm_bindgen]
pub fn render_complex_graph(
    full_w:u16, full_h:u16, ox:u16, oy:u16, w:u16, h:u16,
    commands:Vec<f64>, canonical:bool
) -> Vec<u8> {
    if full_w==0 || full_h==0 || w==0 || h==0
        || u32::from(ox)+u32::from(w)>u32::from(full_w)
        || u32::from(oy)+u32::from(h)>u32::from(full_h)
        || commands.len()>14000 || commands.iter().any(|v| !v.is_finite() || v.abs()>1e6)
    {return Vec::new();}
    use vello_cpu::peniko::{BlendMode, Mix, Compose};
    vello_common::pfx_trace::begin_extended(ox,oy,full_w,full_h,canonical,false);
    let mut ctx=RenderContext::new(w,h);
    let mut res=Resources::new();
    let local=Affine::translate((-f64::from(ox),-f64::from(oy)));
    ctx.set_transform(local);
    // Entirely deterministic static canvas background and underneath stroke.
    ctx.set_paint(css::WHITE);
    ctx.fill_rect(&Rect::new(22.0,23.0,f64::from(full_w)-24.0,f64::from(full_h)-20.0));
    ctx.set_paint(css::MAGENTA);
    ctx.fill_rect(&Rect::new(302.0,213.0,603.0,230.0));

    // Stack stores (absolute group translation, has_clip), no byte raster data.
    let mut groups:Vec<(f64,f64,bool)>=Vec::new();
    let mut i=0_usize;
    let mut processed=0_usize;
    let mut ok=true;
    while i<commands.len(){
        processed+=1;
        if processed>512 {ok=false;break;}
        let kind=commands[i];
        if kind==1.0 { // open group: [1,id,dx,dy,alpha,blend,clip,x0,y0,x1,y1]
            if i+11>commands.len() || groups.len()>=8 {ok=false;break;}
            let dx=commands[i+2];
            let dy=commands[i+3];
            let opacity=commands[i+4];
            let blend=commands[i+5];
            let flag=commands[i+6];
            if !(0.0..=1.0).contains(&opacity)
                || !(0.0..=3.0).contains(&blend) || blend.fract()!=0.0
                || !(flag==0.0 || flag==1.0) {ok=false;break;}
            let (px,py)=groups.last().map(|g|(g.0,g.1)).unwrap_or((0.0,0.0));
            let tx=px+dx;
            let ty=py+dy;
            ctx.set_transform(local*Affine::translate((tx,ty)));
            let mix=match blend as u8 {
                1=>Mix::Multiply,2=>Mix::Screen,3=>Mix::Overlay,_=>Mix::Normal
            };
            ctx.push_blend_layer(BlendMode{mix,compose:Compose::SrcOver});
            ctx.push_opacity_layer(opacity as f32);
            if flag==1.0 {
                if !(commands[i+7]<commands[i+9] && commands[i+8]<commands[i+10]){
                    ok=false;break;
                }
                ctx.push_clip_rect(&Rect::new(
                    commands[i+7],commands[i+8],commands[i+9],commands[i+10]
                ));
            }
            groups.push((tx,ty,flag==1.0));
            i+=11;
        } else if kind==2.0 { // close group
            let Some((_,_,clipped))=groups.pop() else {ok=false;break;};
            if clipped {ctx.pop_clip();}
            ctx.pop_layer(); // opacity group
            ctx.pop_layer(); // blend isolation group
            let (tx,ty)=groups.last().map(|g|(g.0,g.1)).unwrap_or((0.0,0.0));
            ctx.set_transform(local*Affine::translate((tx,ty)));
            i+=1;
        } else if kind==3.0 { // arbitrary Bézier path
            if i+8>commands.len(){ok=false;break;}
            let dx=commands[i+2];
            let dy=commands[i+3];
            let opacity=commands[i+4];
            let color=commands[i+5];
            let stroke=commands[i+6];
            let segments=commands[i+7];
            if !(0.0..=1.0).contains(&opacity)
                || !(0.0..=2.0).contains(&color)||color.fract()!=0.0
                || !(0.0..=120.0).contains(&stroke)
                || !(1.0..=100.0).contains(&segments)||segments.fract()!=0.0
            {ok=false;break;}
            i+=8;
            let mut p=BezPath::new();
            let mut have_move=false;
            for _ in 0..segments as usize {
                if i>=commands.len(){ok=false;break;}
                let verb=commands[i];i+=1;
                let n=match verb {
                    10.0=>2,11.0=>2,12.0=>4,13.0=>6,14.0=>0,_=>{ok=false;break;}
                };
                if i+n>commands.len(){ok=false;break;}
                if !have_move && verb!=10.0 {ok=false;break;}
                if verb==10.0 {
                    p.move_to((commands[i],commands[i+1]));have_move=true;
                } else if verb==11.0 {
                    p.line_to((commands[i],commands[i+1]));
                } else if verb==12.0 {
                    p.quad_to((commands[i],commands[i+1]),(commands[i+2],commands[i+3]));
                } else if verb==13.0 {
                    p.curve_to((commands[i],commands[i+1]),(commands[i+2],commands[i+3]),
                        (commands[i+4],commands[i+5]));
                } else {
                    p.close_path();
                }
                i+=n;
            }
            if !ok{break;}
            let (px,py)=groups.last().map(|g|(g.0,g.1)).unwrap_or((0.0,0.0));
            ctx.set_transform(local*Affine::translate((px+dx,py+dy)));
            ctx.push_opacity_layer(opacity as f32);
            ctx.set_paint(match color as u8 {
                1=>css::WHITE,2=>css::BLUE,_=>css::MAGENTA
            });
            if stroke>0.0{
                ctx.set_stroke(Stroke::new(stroke));
                ctx.stroke_path(&p);
            }else{
                ctx.fill_path(&p);
            }
            ctx.pop_layer();
        } else {ok=false;break;}
    }
    if !ok || !groups.is_empty(){
        vello_common::pfx_trace::end();
        return Vec::new();
    }
    ctx.flush();
    let mut pixmap=Pixmap::new(w,h);
    ctx.render(&mut pixmap,&mut res);
    let mut bytes=Vec::with_capacity(usize::from(w)*usize::from(h)*4);
    for px in pixmap.data(){bytes.extend_from_slice(&[px.r,px.g,px.b,px.a]);}
    vello_common::pfx_trace::end();
    bytes
}

// Independent affine-transform extension: arbitrary Bézier move/line/quad/cubic
// command coordinates. Node transforms, nested opacity, mix and group clipping
// come from the SAME command stream for full- and tile-frame renders.
#[wasm_bindgen]
pub fn render_complex_affine_graph(
    full_w:u16, full_h:u16, ox:u16, oy:u16, w:u16, h:u16,
    commands:Vec<f64>, canonical:bool
) -> Vec<u8> {
    if full_w==0 || full_h==0 || w==0 || h==0
        || u32::from(ox)+u32::from(w)>u32::from(full_w)
        || u32::from(oy)+u32::from(h)>u32::from(full_h)
        || commands.len()>14000 || commands.iter().any(|v| !v.is_finite() || v.abs()>1e6)
    {return Vec::new();}
    use vello_cpu::peniko::{BlendMode, Mix, Compose};
    vello_common::pfx_trace::begin_extended(ox,oy,full_w,full_h,canonical,false);
    let mut ctx=RenderContext::new(w,h);
    let mut res=Resources::new();
    let local=Affine::translate((-f64::from(ox),-f64::from(oy)));
    ctx.set_transform(local);
    // Entirely deterministic static canvas background and underneath stroke.
    ctx.set_paint(css::WHITE);
    ctx.fill_rect(&Rect::new(22.0,23.0,f64::from(full_w)-24.0,f64::from(full_h)-20.0));
    ctx.set_paint(css::MAGENTA);
    ctx.fill_rect(&Rect::new(302.0,213.0,603.0,230.0));

    // Each stack entry stores the exact global affine and group clipping flag.
    let mut groups:Vec<(Affine,bool)>=Vec::new();
    let mut i=0_usize;
    let mut processed=0_usize;
    let mut ok=true;
    while i<commands.len(){
        processed+=1;
        if processed>512 {ok=false;break;}
        let kind=commands[i];
        if kind==1.0 { // open group: [1,id,dx,dy,alpha,blend,clip,x0,y0,x1,y1]
            if i+15>commands.len() || groups.len()>=8 {ok=false;break;}
            let transform=Affine::new([
                commands[i+2],commands[i+3],commands[i+4],
                commands[i+5],commands[i+6],commands[i+7],
            ]);
            let opacity=commands[i+8];
            let blend=commands[i+9];
            let flag=commands[i+10];
            if !(0.0..=1.0).contains(&opacity)
                || !(0.0..=3.0).contains(&blend) || blend.fract()!=0.0
                || !(flag==0.0 || flag==1.0) {ok=false;break;}
            let parent=groups.last().map(|g|g.0).unwrap_or(Affine::IDENTITY);
            let world=parent*transform;
            ctx.set_transform(local*world);
            let mix=match blend as u8 {
                1=>Mix::Multiply,2=>Mix::Screen,3=>Mix::Overlay,_=>Mix::Normal
            };
            ctx.push_blend_layer(BlendMode{mix,compose:Compose::SrcOver});
            ctx.push_opacity_layer(opacity as f32);
            if flag==1.0 {
                if !(commands[i+11]<commands[i+13] && commands[i+12]<commands[i+14]){
                    ok=false;break;
                }
                ctx.push_clip_rect(&Rect::new(
                    commands[i+11],commands[i+12],commands[i+13],commands[i+14]
                ));
            }
            groups.push((world,flag==1.0));
            i+=15;
        } else if kind==2.0 { // close group
            let Some((_,clipped))=groups.pop() else {ok=false;break;};
            if clipped {ctx.pop_clip();}
            ctx.pop_layer(); // opacity group
            ctx.pop_layer(); // blend isolation group
            let parent=groups.last().map(|g|g.0).unwrap_or(Affine::IDENTITY);
            ctx.set_transform(local*parent);
            i+=1;
        } else if kind==3.0 { // arbitrary Bézier path
            if i+12>commands.len(){ok=false;break;}
            let transform=Affine::new([
                commands[i+2],commands[i+3],commands[i+4],
                commands[i+5],commands[i+6],commands[i+7],
            ]);
            let opacity=commands[i+8];
            let color=commands[i+9];
            let stroke=commands[i+10];
            let segments=commands[i+11];
            if !(0.0..=1.0).contains(&opacity)
                || !(0.0..=2.0).contains(&color)||color.fract()!=0.0
                || !(0.0..=120.0).contains(&stroke)
                || !(1.0..=100.0).contains(&segments)||segments.fract()!=0.0
            {ok=false;break;}
            i+=12;
            let mut p=BezPath::new();
            let mut have_move=false;
            for _ in 0..segments as usize {
                if i>=commands.len(){ok=false;break;}
                let verb=commands[i];i+=1;
                let n=match verb {
                    10.0=>2,11.0=>2,12.0=>4,13.0=>6,14.0=>0,_=>{ok=false;break;}
                };
                if i+n>commands.len(){ok=false;break;}
                if !have_move && verb!=10.0 {ok=false;break;}
                if verb==10.0 {
                    p.move_to((commands[i],commands[i+1]));have_move=true;
                } else if verb==11.0 {
                    p.line_to((commands[i],commands[i+1]));
                } else if verb==12.0 {
                    p.quad_to((commands[i],commands[i+1]),(commands[i+2],commands[i+3]));
                } else if verb==13.0 {
                    p.curve_to((commands[i],commands[i+1]),(commands[i+2],commands[i+3]),
                        (commands[i+4],commands[i+5]));
                } else {
                    p.close_path();
                }
                i+=n;
            }
            if !ok{break;}
            let parent=groups.last().map(|g|g.0).unwrap_or(Affine::IDENTITY);
            ctx.set_transform(local*parent*transform);
            ctx.push_opacity_layer(opacity as f32);
            ctx.set_paint(match color as u8 {
                1=>css::WHITE,2=>css::BLUE,_=>css::MAGENTA
            });
            if stroke>0.0{
                ctx.set_stroke(Stroke::new(stroke));
                ctx.stroke_path(&p);
            }else{
                ctx.fill_path(&p);
            }
            ctx.pop_layer();
        } else {ok=false;break;}
    }
    if !ok || !groups.is_empty(){
        vello_common::pfx_trace::end();
        return Vec::new();
    }
    ctx.flush();
    let mut pixmap=Pixmap::new(w,h);
    ctx.render(&mut pixmap,&mut res);
    let mut bytes=Vec::with_capacity(usize::from(w)*usize::from(h)*4);
    for px in pixmap.data(){bytes.extend_from_slice(&[px.r,px.g,px.b,px.a]);}
    vello_common::pfx_trace::end();
    bytes
}

// Controlled numerical stress only: explicit sharp miter joins, a global
// alpha mask, and optional Vello CPU Gaussian filter. The filter is known
// to need outside-region source pixels; safe=true uses a labeled full-frame
// fallback for filtered partial regions rather than silently claiming tiling.
#[wasm_bindgen]
pub fn render_complex_boundary_effect(
    full_w:u16,full_h:u16,ox:u16,oy:u16,w:u16,h:u16,
    matrix:Vec<f64>, mode:u8, shift:f64, width:f64, canonical:bool, safe:bool
)->Vec<u8>{
    if full_w==0||full_h==0||w==0||h==0
      || u32::from(ox)+u32::from(w)>u32::from(full_w)
      || u32::from(oy)+u32::from(h)>u32::from(full_h)
      || matrix.len()!=6||matrix.iter().any(|v| !v.is_finite()||v.abs()>1e6)
      || !shift.is_finite()||!width.is_finite()||width<=0.0||width>100.0
      || mode>3 {return Vec::new();}
    if safe&&mode>=2&&(ox!=0||oy!=0||w!=full_w||h!=full_h) {
        // Consciously correct fallback until filter halo / source expansion is
        // independently established. Full raster cannot be called "dirty ROI".
        let source=render_complex_boundary_effect(
            full_w,full_h,0,0,full_w,full_h,matrix,mode,shift,width,canonical,false
        );
        if source.len()!=usize::from(full_w)*usize::from(full_h)*4{return Vec::new();}
        let mut crop=Vec::with_capacity(usize::from(w)*usize::from(h)*4);
        for row in 0..usize::from(h) {
            let start=((row+usize::from(oy))*usize::from(full_w)+usize::from(ox))*4;
            crop.extend_from_slice(&source[start..start+usize::from(w)*4]);
        }
        return crop;
    }
    use vello_cpu::kurbo::Join;
    use vello_cpu::filter_effects::{Filter,FilterFunction};
    use vello_cpu::Mask;
    vello_common::pfx_trace::begin_extended(ox,oy,full_w,full_h,canonical,false);
    let mut ctx=RenderContext::new(w,h);
    let mut res=Resources::new();
    let local=Affine::translate((-f64::from(ox),-f64::from(oy)));
    ctx.set_transform(local);
    ctx.set_paint(css::WHITE);
    ctx.fill_rect(&Rect::new(25.0,27.0,f64::from(full_w)-21.0,f64::from(full_h)-21.0));
    let world=Affine::new([
        matrix[0],matrix[1],matrix[2],matrix[3],matrix[4],matrix[5]
    ]);
    ctx.set_transform(local*world);
    // Mask alpha is generated in absolute global coordinates for the entire
    // target; its values are invariant under changing the dirty viewport.
    if mode==1||mode==3 {
        let mut alpha=Vec::with_capacity(usize::from(w)*usize::from(h));
        let cx=506.375+shift*0.5;
        let cy=246.125;
        for y in 0..u32::from(h) {
            for x in 0..u32::from(w) {
                let ax=f64::from(ox)+f64::from(x);
                let ay=f64::from(oy)+f64::from(y);
                let d=((ax-cx)/165.5).powi(2)+((ay-cy)/122.75).powi(2);
                let opacity=((1.05-d)*9.0).clamp(0.0,1.0);
                alpha.push((opacity*255.0+0.5) as u8);
            }
        }
        ctx.push_mask_layer(Mask::from_parts(alpha,w,h));
    }
    if mode>=2 {
        ctx.push_filter_layer(Filter::from_function(FilterFunction::Blur{radius:5.25}));
    }
    ctx.set_paint(css::MAGENTA);
    let mut path=BezPath::new();
    path.move_to((421.125+shift,250.375));
    path.line_to((517.625+shift,258.125));
    path.line_to((441.375+shift,266.625));
    path.line_to((632.125+shift,289.625));
    ctx.set_stroke(
        Stroke::new(width).with_join(Join::Miter).with_miter_limit(12.0)
    );
    ctx.stroke_path(&path);
    let mut fill=BezPath::new();
    fill.move_to((444.875+shift,215.625));
    fill.curve_to((475.625+shift,161.125),(608.375+shift,183.875),(622.125+shift,259.625));
    fill.quad_to((544.375+shift,319.125),(444.875+shift,215.625));
    fill.close_path();
    ctx.set_paint(css::BLUE);
    ctx.fill_path(&fill);
    if mode>=2{ctx.pop_layer();}
    if mode==1||mode==3{ctx.pop_layer();}
    ctx.flush();
    let mut pixmap=Pixmap::new(w,h);
    ctx.render(&mut pixmap,&mut res);
    let mut bytes=Vec::with_capacity(usize::from(w)*usize::from(h)*4);
    for px in pixmap.data(){bytes.extend_from_slice(&[px.r,px.g,px.b,px.a]);}
    vello_common::pfx_trace::end();
    bytes
}

// Variable blur radius stress: standalone pinned CPU wasm entrypoint.
// Controlled numerical stress only: explicit sharp miter joins, a global
// alpha mask, and optional Vello CPU Gaussian filter. The filter is known
// to need outside-region source pixels; safe=true uses a labeled full-frame
// fallback for filtered partial regions rather than silently claiming tiling.
#[wasm_bindgen]
pub fn render_complex_boundary_radius(
    full_w:u16,full_h:u16,ox:u16,oy:u16,w:u16,h:u16,
    matrix:Vec<f64>, mode:u8, shift:f64, width:f64, radius:f64, canonical:bool, safe:bool
)->Vec<u8>{
    if full_w==0||full_h==0||w==0||h==0
      || u32::from(ox)+u32::from(w)>u32::from(full_w)
      || u32::from(oy)+u32::from(h)>u32::from(full_h)
      || matrix.len()!=6||matrix.iter().any(|v| !v.is_finite()||v.abs()>1e6)
      || !shift.is_finite()||!width.is_finite()||width<=0.0||width>100.0
      || mode>3 || !radius.is_finite() || !(0.0..=24.0).contains(&radius) {return Vec::new();}
    if safe&&mode>=2&&(ox!=0||oy!=0||w!=full_w||h!=full_h) {
        // Consciously correct fallback until filter halo / source expansion is
        // independently established. Full raster cannot be called "dirty ROI".
        let source=render_complex_boundary_radius(
            full_w,full_h,0,0,full_w,full_h,matrix,mode,shift,width,radius,canonical,false
        );
        if source.len()!=usize::from(full_w)*usize::from(full_h)*4{return Vec::new();}
        let mut crop=Vec::with_capacity(usize::from(w)*usize::from(h)*4);
        for row in 0..usize::from(h) {
            let start=((row+usize::from(oy))*usize::from(full_w)+usize::from(ox))*4;
            crop.extend_from_slice(&source[start..start+usize::from(w)*4]);
        }
        return crop;
    }
    use vello_cpu::kurbo::Join;
    use vello_cpu::filter_effects::{Filter,FilterFunction};
    use vello_cpu::Mask;
    vello_common::pfx_trace::begin_extended(ox,oy,full_w,full_h,canonical,false);
    let mut ctx=RenderContext::new(w,h);
    let mut res=Resources::new();
    let local=Affine::translate((-f64::from(ox),-f64::from(oy)));
    ctx.set_transform(local);
    ctx.set_paint(css::WHITE);
    ctx.fill_rect(&Rect::new(25.0,27.0,f64::from(full_w)-21.0,f64::from(full_h)-21.0));
    let world=Affine::new([
        matrix[0],matrix[1],matrix[2],matrix[3],matrix[4],matrix[5]
    ]);
    ctx.set_transform(local*world);
    // Mask alpha is generated in absolute global coordinates for the entire
    // target; its values are invariant under changing the dirty viewport.
    if mode==1||mode==3 {
        let mut alpha=Vec::with_capacity(usize::from(w)*usize::from(h));
        let cx=506.375+shift*0.5;
        let cy=246.125;
        for y in 0..u32::from(h) {
            for x in 0..u32::from(w) {
                let ax=f64::from(ox)+f64::from(x);
                let ay=f64::from(oy)+f64::from(y);
                let d=((ax-cx)/165.5).powi(2)+((ay-cy)/122.75).powi(2);
                let opacity=((1.05-d)*9.0).clamp(0.0,1.0);
                alpha.push((opacity*255.0+0.5) as u8);
            }
        }
        ctx.push_mask_layer(Mask::from_parts(alpha,w,h));
    }
    if mode>=2 {
        ctx.push_filter_layer(Filter::from_function(FilterFunction::Blur{radius:radius as f32}));
    }
    ctx.set_paint(css::MAGENTA);
    let mut path=BezPath::new();
    path.move_to((421.125+shift,250.375));
    path.line_to((517.625+shift,258.125));
    path.line_to((441.375+shift,266.625));
    path.line_to((632.125+shift,289.625));
    ctx.set_stroke(
        Stroke::new(width).with_join(Join::Miter).with_miter_limit(12.0)
    );
    ctx.stroke_path(&path);
    let mut fill=BezPath::new();
    fill.move_to((444.875+shift,215.625));
    fill.curve_to((475.625+shift,161.125),(608.375+shift,183.875),(622.125+shift,259.625));
    fill.quad_to((544.375+shift,319.125),(444.875+shift,215.625));
    fill.close_path();
    ctx.set_paint(css::BLUE);
    ctx.fill_path(&fill);
    if mode>=2{ctx.pop_layer();}
    if mode==1||mode==3{ctx.pop_layer();}
    ctx.flush();
    let mut pixmap=Pixmap::new(w,h);
    ctx.render(&mut pixmap,&mut res);
    let mut bytes=Vec::with_capacity(usize::from(w)*usize::from(h)*4);
    for px in pixmap.data(){bytes.extend_from_slice(&[px.r,px.g,px.b,px.a]);}
    vello_common::pfx_trace::end();
    bytes
}
