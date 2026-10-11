// Temporary compatibility probe compiled inside pinned upstream Vello source.
// This file is injected into its examples/ directory by the CI job.
use std::{fs::File, io::{BufWriter,Write}, time::Instant};
use vello_cpu::{RenderContext,Resources,Pixmap};
use vello_cpu::{color::palette::css, kurbo::Rect};

const W:u16=320; const H:u16=180;
fn main(){
  let mut context=RenderContext::new(W,H);
  let mut resources=Resources::new();
  context.set_paint(css::MAGENTA);
  context.fill_rect(&Rect::from_points((50.,20.),(250.,160.)));
  let mut pixmap=Pixmap::new(W,H);
  let start=Instant::now();
  context.flush();
  context.render(&mut pixmap,&mut resources);
  let render_ns=start.elapsed().as_nanos();
  let p=pixmap.data();
  let inside=p[(80 * usize::from(W))+100];
  let outside=p[0];
  assert_eq!(inside,css::MAGENTA.premultiply().to_rgba8(),"inside rectangle");
  assert_eq!(outside.a,0,"background should remain transparent");
  assert_eq!(p.len(),usize::from(W)*usize::from(H));
  let out=std::env::var("PFX_OUTPUT").unwrap_or_else(|_|"vello-cpu.ppm".into());
  let mut file=BufWriter::new(File::create(&out).expect("open PPM"));
  write!(file,"P6\n{} {}\n255\n",W,H).expect("PPM header");
  for pixel in p{
    file.write_all(&[pixel.r,pixel.g,pixel.b]).expect("PPM pixels");
  }
  file.flush().expect("flush");
  println!("PFX_PROBE_RESULT renderer=vello_cpu width={} height={} render_ns={}     inside_rgba={},{},{},{} outside_alpha={} artifact={}",
    W,H,render_ns,inside.r,inside.g,inside.b,inside.a,outside.a,out);
}
