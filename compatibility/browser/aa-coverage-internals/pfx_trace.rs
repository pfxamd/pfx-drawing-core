// Experiment-only Vello source instrumentation. Never ship as engine code.
// Records the actual post-flatten f32 line segments and pre-u8 strip mask values.
use alloc::vec::Vec;
use std::sync::{Mutex, OnceLock};
use crate::flatten::Line;

#[derive(Default)]
struct Capture {
    enabled: bool,
    origin_x: u16,
    origin_y: u16,
    lines: Vec<f32>,
    pixels: Vec<f32>,
    path_index: usize,
    truncated: bool,
}
static STATE: OnceLock<Mutex<Capture>> = OnceLock::new();
fn state() -> &'static Mutex<Capture> {
    STATE.get_or_init(|| Mutex::new(Capture::default()))
}
pub fn begin(origin_x: u16, origin_y: u16) {
    let mut s=state().lock().expect("trace lock");
    s.enabled=true;
    s.origin_x=origin_x;
    s.origin_y=origin_y;
    s.path_index=0;
    s.truncated=false;
    s.lines.clear();
    s.pixels.clear();
}
pub fn end() {
    state().lock().expect("trace lock").enabled=false;
}
pub fn is_enabled()->bool {
    state().lock().expect("trace lock").enabled
}
pub fn record_lines(lines: &[Line]) {
    let mut s=state().lock().expect("trace lock");
    if !s.enabled { return; }
    let path=s.path_index as f32;
    s.path_index+=1;
    for (i,line) in lines.iter().enumerate() {
        if s.lines.len()>=6*40_000 {s.truncated=true;break;}
        s.lines.extend_from_slice(&[
            path,i as f32,line.p0.x,line.p0.y,line.p1.x,line.p1.y
        ]);
    }
}
pub fn record_tile(tile_x:u16,tile_y:u16,pre:&[[f32;4];4],byte:&[u8;16]) {
    let mut s=state().lock().expect("trace lock");
    if !s.enabled {return;}
    let ox=u32::from(s.origin_x);
    let oy=u32::from(s.origin_y);
    for x in 0..4_usize {
        for y in 0..4_usize {
            let global_x=ox+u32::from(tile_x)*4+x as u32;
            let global_y=oy+u32::from(tile_y)*4+y as u32;
            if !(464..776).contains(&global_x)||!(112..344).contains(&global_y) {continue;}
            let v=pre[x][y];
            let alpha=byte[x*4+y];
            if (alpha==0 || alpha==255) && !(v>0.0 && v<255.0){continue;}
            if s.pixels.len()>=4*180_000{s.truncated=true;return;}
            // [absolute x,absolute y, actual f32(coverage*255+0.5) pre-int, quantized u8]
            s.pixels.extend_from_slice(&[global_x as f32,global_y as f32,v,alpha as f32]);
        }
    }
}
pub fn lines()->Vec<f32> {
    state().lock().expect("trace lock").lines.clone()
}
pub fn pixels()->Vec<f32> {
    state().lock().expect("trace lock").pixels.clone()
}
pub fn truncated()->bool {
    state().lock().expect("trace lock").truncated
}
