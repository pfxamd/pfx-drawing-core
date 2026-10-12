# Complex antialiased Bézier shapes and overlapping dirty regions

## Verified CI result — 2026-10-12

- [Successful run 38242292443](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38242292443)
  executed the 21 browser scenarios in 3 fresh-context repetitions each:
  **21 / 21 passed, 3360 / 3360 frames**.
- [43-file evidence artifact](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38242292443/artifacts/11743396428):
  21 PNG screenshots, 21 per-case JSONs and one aggregate summary.
- The running engine was the **actual pinned-source Vello CPU WASM**, compiled successfully
  by the build job in [run 38241471305](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38241471305)
  at commit `35bca973a4d033e555d33620727f72cdbf179861`. The successful browser run
  replayed the same compiled binaries while refining the precision acceptance check.
  Filament WASM is reused from the original pinned-source proof.
- Real screenshots of moving antialiased, overlapping 2D Bézier paths in front of
  a moving 3D Filament cube were downloaded and visually inspected.

**Performance measurements:** median of the per-run 95th-percentile CPU-side
frame work durations over 3 runs for each workload, **not hardware GPU timing**.

| Workload | Frames | CPU frame work p95, ms | RAF interval p95, ms | Vello raster call p95, ms | Canvas upload call p95, ms | RGBA input across 3 runs |
|---|---:|---:|---:|---:|---:|---:|
| 3D only | 480 | 0.5 | 16.7 | — | — | 0 |
| 2D full | 480 | 12.9 | 16.7 | 6.6 | 3.0 | 772,800,000 bytes |
| 2D union | 480 | 5.7 | 16.7 | 1.3 | 4.1 | 169,950,720 bytes |
| 2D overlap | 480 | 6.3 | 16.7 | 2.7 | 1.9 | 164,544,000 bytes |
| Mixed full | 480 | 14.8 | 16.8 | 7.8 | 3.9 | 772,800,000 bytes |
| Mixed union | 480 | **6.7** | 16.8 | 2.3 | 4.6 | 169,950,720 bytes |
| Mixed overlap | 480 | **6.9** | 16.7 | 3.2 | 2.2 | 164,544,000 bytes |

The mixed-mode union reduced observed median CPU frame work p95 by about
**54.7%** relative to full-frame Vello repaint for this scene; overlapping tiles
gave about **53.4%** less. The count of input RGBA bytes was **78.0%** lower
for union and **78.7%** lower for overlapping tiles than for full redraw.
Overlapping regions are not necessarily faster despite slightly fewer input bytes,
because two raster operations and two uploads are needed each callback.

**Numerical image correctness — limitation, not hidden:** the pixel-exact
reference test failed in the first three development runs. After inspecting
location, channel and magnitude, the independently rasterized antialiased
Vello paths differ only **1/255** in a sparse subset of component values:

- Over 4 verification frames, 33 mismatched channel values for the bounding union,
  14 for tile A and 27 for tile B, totaling **74 of 2,707,456** independently
  compared RGBA channels (**0.00273%**; no channel difference exceeds 1).
- Final displayed 800 x 500 RGBA image in the mixed overlapped example differed
  by **5 of 1,600,000** byte channels from the independently regenerated full
  reference. Those 5 also differed by no more than 1.
- The test explicitly fails if any difference exceeds 1/255 or if more than
  **0.01%** of channels differ. The recorded observation is *bounded numerical
  equivalence*, **not bit-exact pixel equality**.
- Partial-alpha antialiased edges and painted areas in overlapping tiles are
  explicitly asserted, as are motion, resource isolation and zero unexpected
  WebGL context losses.

**Research outcome:** separate dirty-region Vello CPU redraws can materially
reduce this benchmark's observed CPU work and RGBA input size while retaining
near-identical scene output, but bit-exact antialiasing remains unresolved.
The experiment uses manually specified conservative dirty bounds, not automatic
damage tracking. It cannot establish GPU hardware performance, true VRAM use,
browser compositor timings, shared context ownership or production readiness.
**No final engine choice and no merge to main.**

## Experiment

New experimental source-built Vello CPU WASM module at the original upstream pinned SHA
`235739c4f08eb48d900e1512459d453a9ab77f96`, with path geometry that changes on
each animation frame. The shapes include cubic and quadratic curves, fractional
subpixel offsets, white/magenta overlapping filled shapes and antialiased edges.
The same source-built Filament 3D cube runs simultaneously in mixed mode.

Compare 3 different 2D strategies, each with and without Filament:

- **full**: re-render the complete 800 x 500 RGBA Vello image each frame.
- **union**: re-render one 336 x 256 bounding rectangle at (448,96).
- **overlap**: re-render two intersecting rectangles, A=(448,96,208,208)
  and B=(592,144,192,208). Their intersection is **64 x 160** pixels.
  Each tile independently rerenders the entire ordered path scene, so its
  already-composited RGBA can replace overlapping Canvas2D pixels exactly.

One 3D-only baseline plus 6 Vello cases, each repeated in 3 new browser contexts.
**21 cases x 160 frames = 3360 frames** total, with independent contexts and
rotated test order to reduce (not eliminate) order bias.

## Correctness gates

For frames 0, 43, 97 and 159:

- Render a separate full Vello reference;
- Compare each byte of the union, tile A and tile B RGBA against the corresponding
  global full-image crop, recording precise channel differences;
- Require partial-alpha pixels (AA genuinely active), painted pixels in tile
  intersection and moving geometry;
- Compare the entire final 800 x 500 Canvas2D image against the full source output,
  including old positions to expose un-erased residue;
- Verify visible Filament cube motion, isolated module requests, no off-origin requests,
  no thrown errors and zero unexpected WebGL context losses.

The test **must fail** if any channel differs by more than 1/255 or if
more than 0.01% of the compared channel values differ. Exact byte equality
is still recorded separately and is **not** claimed where it is false.
The original unmodified strict tests on 2026-10-12 reported 32 channel
mismatches in the union, 10 in tile A and 27 in tile B. Aligning the
rectangles to 16-pixel origins produced 33, 14 and 27, respectively,
each with absolute channel difference **1/255**. This is a numeric
subpixel AA precision limit in the tested Vello CPU code path and must
not be concealed by reporting zero mismatch.

## Measurement

Capture per-case 3D CPU submission timing, per-frame JS CPU work, Vello raster,
RGBA pixel copy and Canvas2D upload call times, rAF callback spacing, JS heap
and actual Vello-to-Canvas2D buffer counts. The expected per-frame buffer sizes:

| Render strategy | Bytes of RGBA raster output |
|---|---:|
| Full | 1,600,000 |
| Union | 344,064 |
| Two overlapping tiles | 332,800 |

These are CPU-side byte counts, not verified physical GPU bus transfer bytes.
Exactness holds only for the tested geometry, coordinate system, pixel alignment
and backend, not arbitrary future zoom/masks/filters/strokes/text.

Headless Chromium uses SwiftShader software WebGL2, and Vello CPU uses its own
WASM-backed drawing layer, composited with Filament's 3D canvas by Chromium.
This does not measure GPU execution or prove a shared device. The branch is
experimental, and `main` must stay unchanged.
