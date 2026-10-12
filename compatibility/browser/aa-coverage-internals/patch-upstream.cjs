'use strict';
// Surgical, assertive patch of ONE pinned upstream Vello checkout in CI.
// Never commits changes to the upstream project or PFx production branches.
const fs=require('node:fs');
const path=require('node:path');
const root=process.argv[2];
if(!root)throw Error('Expected pinned Vello checkout');
function edit(file,needle,replacement){
 const full=path.join(root,file),old=fs.readFileSync(full,'utf8');
 const at=old.indexOf(needle);
 if(at<0||old.indexOf(needle,at+needle.length)>=0)
   throw Error('Missing or non-unique pinned source anchor in '+file);
 fs.writeFileSync(full,old.replace(needle,replacement));
 process.stdout.write('PATCH '+file+'\n');
}
fs.copyFileSync(path.join(__dirname,'pfx_trace.rs'),
  path.join(root,'vello_common/src/pfx_trace.rs'));
edit('vello_common/src/lib.rs',
  'pub mod flatten;\n',
  'pub mod flatten;\npub mod pfx_trace;\n');
edit('vello_common/src/strip_generator.rs',
  '        self.generate_with_clip(aliasing_threshold, strip_storage, fill_rule, clip_path);\n',
  '        crate::pfx_trace::record_lines(&self.line_buf);\n        self.generate_with_clip(aliasing_threshold, strip_storage, fill_rule, clip_path);\n');
// Alternative diagnostic branch: flatten in the same global coordinate frame
// as the 800x500 reference BEFORE f64 -> f32 conversion, then shift the already
// flattened f32 segments to the local raster space. Keep tile/strip stages
// unchanged; this isolates the influence of pre-quantization geometry origins.
edit('vello_common/src/strip_generator.rs',
  `        flatten::fill(
            self.level,
            path,
            transform,
            &mut self.line_buf,
            &mut self.flatten_ctx,
            cull_bbox,
        );`,
  `        let (canonical, origin_x, origin_y) = crate::pfx_trace::geometry_mode();
        if canonical && (origin_x != 0 || origin_y != 0) {
            // Render the globally identical tessellation as the full canvas.
            // Keep this experimental canonical bbox fixed to the proof scene.
            let absolute_transform = Affine::translate((
                f64::from(origin_x), f64::from(origin_y),
            )) * transform;
            flatten::fill(
                self.level, path, absolute_transform, &mut self.line_buf,
                &mut self.flatten_ctx, RectU16::new(0, 0, 800, 500),
            );
            // The downstream tile/strip rasterizer still works locally.
            let ox=f32::from(origin_x);
            let oy=f32::from(origin_y);
            for line in &mut self.line_buf {
                line.p0.x -= ox; line.p0.y -= oy;
                line.p1.x -= ox; line.p1.y -= oy;
            }
        } else {
            flatten::fill(
                self.level, path, transform, &mut self.line_buf,
                &mut self.flatten_ctx, cull_bbox,
            );
        }`);
edit('vello_common/src/strip.rs',
  '            alpha_buf.extend_from_slice(u8_vals.as_slice());\n',
  `            // PFx diagnostic only: capture actual pre-u8 antialias coverage.
            if crate::pfx_trace::is_enabled() {
                let mut values = [[0.0_f32; 4]; 4];
                for x in 0..4 {
                    values[x].copy_from_slice(location_winding[x].as_slice());
                }
                let mut quantized = [0_u8; 16];
                quantized.copy_from_slice(u8_vals.as_slice());
                crate::pfx_trace::record_tile(prev_tile.x, prev_tile.y, &values, &quantized);
            }
            alpha_buf.extend_from_slice(u8_vals.as_slice());
`);
