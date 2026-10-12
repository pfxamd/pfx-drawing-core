# Real changing Vello geometry: full frame versus dirty tile

**Status: experimental source prepared; no performance claims until a successful CI run.**

## Setup

- Isolated branch `experiment/browser-geometry-dirty-region` derives from the successful
  per-frame Vello/Filament experiment. The pinned Vello revision is unchanged.
- The source-built Vello CPU WebAssembly module contains two exported raster calls:
  `render_dynamic_full(frame)` returns 800 × 500 pixels and
  `render_dynamic_tile(frame)` returns exactly the matching 200 × 140
  raster crop anchored at (550,100).
- Both build new Vello `RenderContext` scenes with **actual frame-varying rectangle
  coordinates**; not a translated cached 2D bitmap.
- Static Vello primitives outside this crop paint the same pixels every frame,
  including magenta paint in front of the Filament animated perspective cube.
- The first render uses the full image; subsequent 180 callbacks use either
  full Vello raster+Canvas2D `putImageData`, or true dirty-region
  Vello raster+Canvas2D `putImageData(tile,550,100)`.
- Compare the same 3D cube with both update policies, plus isolated 2D modes
  and Filament-only baseline. Each of the 5 cases runs in 3 independent browser
  contexts (15 cases, 2700 callback frames total), with counterbalanced order.

## Correctness proof

After collecting timing values, byte-compare independently rendered dirty tile and
the corresponding full-image crop at frames 0, 43, 89 and 179. Also compare the
**entire 800 × 500 Canvas2D buffer** against the final full Vello output, checking
that stale moving geometry was erased. Check real screenshots for movement and
correct foreground alpha over 3D, request isolation and zero runtime errors.

The tile is exactly 200 × 140 × 4 = 112,000 bytes and the full image
800 × 500 × 4 = 1,600,000 bytes. Count these from real returned Vello buffers;
do not confuse these byte counts with physical GPU transfers. Browser timing covers
CPU-side Vello rendering, JS `ImageData` copy, Canvas2D `putImageData`
and end-to-end callback work. Also count callback intervals above 24 ms.

## Limitations

These tests run headless Chromium with **software** SwiftShader. They do not
measure physical GPU completion or VRAM, native desktop, actual compositor cost,
shared GPU ownership, editor-scale geometry complexity, arbitrary dirty rectangles
or SVG path features. Rebuilding Vello `RenderContext` each frame is not the same
as a retained scene graph. The rendered shapes have integer-aligned edges; subpixel
antialiasing and clip-dependent effects need separate coverage.

**No engine selection, no changes to main, and no final integration decision.**
