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
