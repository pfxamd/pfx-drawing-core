# Complex antialiased Bézier shapes and overlapping dirty regions

**Status:** CI test prepared. No results are accepted until the full workflow succeeds.

## Experiment

New experimental source-built Vello CPU WASM module at the original upstream pinned SHA
`235739c4f08eb48d900e1512459d453a9ab77f96`, with path geometry that changes on
each animation frame. The shapes include cubic and quadratic curves, fractional
subpixel offsets, white/magenta overlapping filled shapes and antialiased edges.
The same source-built Filament 3D cube runs simultaneously in mixed mode.

Compare 3 different 2D strategies, each with and without Filament:

- **full**: re-render the complete 800 x 500 RGBA Vello image each frame.
- **union**: re-render one 328 x 240 bounding rectangle at (448,104).
- **overlap**: re-render two intersecting rectangles, A=(448,104,200,190)
  and B=(592,152,184,192). Their intersection is **56 x 142** pixels.
  Each tile independently rerenders the entire ordered path scene, so its
  already-composited RGBA can replace overlapping Canvas2D pixels exactly.

One 3D-only baseline plus 6 Vello cases, each repeated in 3 new browser contexts.
**21 cases x 160 frames = 3360 frames** total, with independent contexts and
rotated test order to reduce (not eliminate) order bias.

## Correctness gates

For frames 0, 43, 97 and 159:

- Render a separate full Vello reference;
- Compare each byte of the union, tile A and tile B RGBA against the corresponding
  global full-image crop;
- Require partial-alpha pixels (AA genuinely active), painted pixels in tile
  intersection and moving geometry;
- Compare the entire final 800 x 500 Canvas2D image against the full source output,
  including old positions to expose un-erased residue;
- Verify visible Filament cube motion, isolated module requests, no off-origin requests,
  no thrown errors and zero unexpected WebGL context losses.

All tests MUST fail on pixel mismatches rather than rounding the difference away.

## Measurement

Capture per-case 3D CPU submission timing, per-frame JS CPU work, Vello raster,
RGBA pixel copy and Canvas2D upload call times, rAF callback spacing, JS heap
and actual Vello-to-Canvas2D buffer counts. The expected per-frame buffer sizes:

| Render strategy | Bytes of RGBA raster output |
|---|---:|
| Full | 1,600,000 |
| Union | 314,880 |
| Two overlapping tiles | 293,312 |

These are CPU-side byte counts, not verified physical GPU bus transfer bytes.
Exactness holds only for the tested geometry, coordinate system, pixel alignment
and backend, not arbitrary future zoom/masks/filters/strokes/text.

Headless Chromium uses SwiftShader software WebGL2, and Vello CPU uses its own
WASM-backed drawing layer, composited with Filament's 3D canvas by Chromium.
This does not measure GPU execution or prove a shared device. The branch is
experimental, and `main` must stay unchanged.
