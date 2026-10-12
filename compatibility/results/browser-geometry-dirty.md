# Real changing Vello geometry: full frame versus dirty tile

## Verified outcome — 2026-10-12

[GitHub Actions run 38234646339](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38234646339)
completed **SUCCESS**, with both the pinned-source Vello CPU WebAssembly build and Chromium
benchmark jobs successful. Test commit: `6b8be93d4e4da3c1e8950d7d0ee113afca052821`.

- **15/15 cases passed, 2700/2700 frames**, covering 3 independent fresh contexts per mode.
- **All 12 Vello-containing cases** passed the 4 independently rerendered full-vs-tile
  reference frames and the **complete final 800 × 500 Canvas2D comparison** with
  **0 different RGBA bytes**. Old painted geometry was erased rather than leaving trails.
- Actual browser screenshot `r3-mixed-dirty.png` was extracted from the
  [31-file browser evidence](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38234646339/artifacts/11740910094)
  and visually inspected: correct dynamic magenta/white Vello geometry, the real
  perspective Filament cube and a magenta bar visibly drawn across it.
- [Source-built Vello WASM binaries and build logs](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38234646339/artifacts/11739913081)
  are retained separately.

**Median of per-run p95 observations across 3 runs, measured in milliseconds:**

| Scenario | Callback frames | Total per-frame CPU work p95 | RAF callback interval p95 | Vello raster call p95 | Canvas2D upload call p95 | Callback intervals >24ms |
|---|---:|---:|---:|---:|---:|---:|
| 3D-only | 540 | 0.4 | 16.8 | — | — | 2 |
| 2D full | 540 | 5.8 | 16.8 | 1.6 | 1.5 | 0 |
| 2D dirty | 540 | **1.0** | 16.7 | 0.2 | 0.8 | 0 |
| 2D + 3D full | 540 | 8.3 | 16.8 | 3.4 | 3.6 | 4 |
| 2D + 3D dirty | 540 | **3.3** | 16.7 | 0.3 | 1.8 | 3 |

| Data handed to Canvas2D from Vello across each three-run scenario | Full updates | Dirty updates |
|---|---:|---:|
| RGBA bytes, including 3 initial full draws | 868,800,000 | 65,280,000 |
| Reduction | — | **92.49%** |

Each full update returns **1,600,000 RGBA bytes**; each dirty update returns
**112,000 bytes**. The dirty sequence additionally uses **one initial full-frame render**
per run. Counts exclude any browser-internal copies or hardware graphics-bus transfers.

**Result:** in this controlled, small, integer-aligned moving rectangle scene,
rebuilding and uploading only the changed Vello tile preserves exact visible pixel
output while reducing observed per-frame CPU work, even alongside the same 3D animation.
The median p95 combined frame-work measurement fell from **8.3 ms to 3.3 ms**
(approximately 60% lower for this specific test workload).

**Critical boundaries:** This is **source-built Vello CPU-WASM plus Filament WebGL2
on Chromium SwiftShader**, not a hardware GPU benchmark, shared device, GPU completion
measurement, compositor trace, arbitrary-shape clipping solution or retained scene-graph
implementation. A smaller `putImageData` input does **not** prove a proportional
reduction in browser-internal GPU traffic or VRAM usage. Reproducing on physical GPU
and with antialiasing / overlapping dirty regions and complex shapes is still required.

**Decision:** keep all candidates experimental; no promotion to main.


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
