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
// 2 = stroked Bézier path, 4 = freeform clip on the scene. No feature is
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
        scene & !7 != 0 || (scene & 3)==0 {
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
