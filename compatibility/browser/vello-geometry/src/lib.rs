// MIT OR Apache-2.0: original PFx browser compatibility sample using Vello CPU.
use wasm_bindgen::prelude::*;
use vello_cpu::{RenderContext, Resources, Pixmap};
use vello_cpu::{color::palette::css, kurbo::Rect};

/// Generates a transparent RGBA canvas image from the source-built Vello engine.
/// Returns straight-alpha pixels for JavaScript ImageData; deliberately does not draw
/// the 3D scene or pretend to share WebGL GPU resources.
#[wasm_bindgen]
pub fn render_overlay(width: u32, height: u32) -> Vec<u8> {
    assert!((64..=4096).contains(&width) && (64..=4096).contains(&height));
    let mut context = RenderContext::new(width as u16, height as u16);
    let mut resources = Resources::new();

    context.set_paint(css::WHITE);
    context.fill_rect(&Rect::new(24.0, 24.0, 255.0, 31.0));
    context.fill_rect(&Rect::new(24.0, 24.0, 31.0, 132.0));
    context.fill_rect(&Rect::new((width - 185) as f64, (height - 31) as f64,
                                 (width - 24) as f64, (height - 24) as f64));

    context.set_paint(css::MAGENTA);
    context.fill_rect(&Rect::new(24.0, 44.0, 180.0, 55.0));
    context.fill_rect(&Rect::new(24.0, (height - 48) as f64, 186.0, (height - 40) as f64));
    let mut pixmap = Pixmap::new(width as u16, height as u16);
    context.flush();
    context.render(&mut pixmap, &mut resources);
    let mut result = Vec::with_capacity(width as usize * height as usize * 4);
    for pixel in pixmap.data() {
        let (r,g,b) = if pixel.a == 0 { (0,0,0) } else {
            let a=pixel.a as u32;
            let unpremul = |v:u8| ((v as u32 * 255 + a/2)/a).min(255) as u8;
            (unpremul(pixel.r),unpremul(pixel.g),unpremul(pixel.b))
        };
        result.extend_from_slice(&[r,g,b,pixel.a]);
    }
    result
}


// Actual geometry is rebuilt every call: integer-aligned moving rectangles.
// The tile output and matching crop of the full image must be byte-identical.
const TILE_X: f64 = 550.0;
const TILE_Y: f64 = 100.0;
const TILE_W: u16 = 200;
const TILE_H: u16 = 140;

fn render_scene(step: u32, tile_only: bool) -> Vec<u8> {
    let (width, height) = if tile_only { (TILE_W, TILE_H) } else { (800, 500) };
    let mut context = RenderContext::new(width, height);
    let mut resources = Resources::new();

    if !tile_only {
        context.set_paint(css::WHITE);
        context.fill_rect(&Rect::new(24.0, 24.0, 255.0, 31.0));
        context.fill_rect(&Rect::new(24.0, 24.0, 31.0, 132.0));
        context.fill_rect(&Rect::new(615.0, 469.0, 776.0, 476.0));
        context.set_paint(css::MAGENTA);
        context.fill_rect(&Rect::new(24.0, 44.0, 180.0, 55.0));
        context.fill_rect(&Rect::new(24.0, 452.0, 186.0, 460.0));
        // Keep a static painted foreground over the moving Filament cube.
        context.fill_rect(&Rect::new(300.0, 212.0, 490.0, 224.0));
    }

    let tx = if tile_only { 0.0 } else { TILE_X };
    let ty = if tile_only { 0.0 } else { TILE_Y };
    let x = tx + 20.0 + f64::from(step % 90);
    let y = ty + 35.0 + f64::from(step % 15);
    context.set_paint(css::MAGENTA);
    context.fill_rect(&Rect::new(x, y, x + 58.0, y + 58.0));
    context.set_paint(css::WHITE);
    context.fill_rect(&Rect::new(x + 6.0, y + 6.0, x + 18.0, y + 18.0));

    let mut pixmap = Pixmap::new(width, height);
    context.flush();
    context.render(&mut pixmap, &mut resources);
    let mut out = Vec::with_capacity(usize::from(width) * usize::from(height) * 4);
    for pixel in pixmap.data() {
        let (r, g, b) = if pixel.a == 0 {
            (0, 0, 0)
        } else {
            let a = u32::from(pixel.a);
            let unpremul = |v: u8| ((u32::from(v) * 255 + a / 2) / a).min(255) as u8;
            (unpremul(pixel.r), unpremul(pixel.g), unpremul(pixel.b))
        };
        out.extend_from_slice(&[r, g, b, pixel.a]);
    }
    out
}

#[wasm_bindgen]
pub fn render_dynamic_full(step: u32) -> Vec<u8> {
    render_scene(step, false)
}

#[wasm_bindgen]
pub fn render_dynamic_tile(step: u32) -> Vec<u8> {
    render_scene(step, true)
}
