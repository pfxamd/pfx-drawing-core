# Source compatibility laboratory

This directory is a **technical decision gate**, not the finished drawing core.

## Established requirements

- Preserve the independently versioned `pfx-geometry-core` geometry kernel.
- Build native Linux and browser versions **from source**, eventually bundling verified source/required dependencies locally.
- Keep 2D rendering, 3D rendering, geometry and the application-independent front end at separate module boundaries.
- Choose by measured quality, correctness, performance, integration cost, GPU ownership and legal compatibility — not by source-code size or implementation convenience.
- Do not treat two independent build successes as proof that two engines can share a device, framebuffer or render loop.

## Phase A — isolated native-source probe (this branch)

The workflow `.github/workflows/source-compatibility.yml` checks out **exact upstream commit SHAs** from `sources.json`, then tests:
- Skia CPU raster build and deterministic native rectangle rendering into a PPM sample.
- Vello CPU build and deterministic native rectangle rendering into a PPM sample.
- Filament native **library compilation** without scene creation or GPU initialization.

CI retains raw logs, times, compiler information, source commit SHAs and actual proof images when builds succeed. Probe failures remain failures rather than being hidden in a green job.

**These probes do not establish browser or mixed-renderer compatibility.**

## Phase B — only after successful isolated builds

- Compile and render Vello GPU WebGL2 and Skia CanvasKit from pinned source; create source-built Filament WebGL scene.
- Compare two full compositions on a single application surface: Skia/Filament vs Vello/Filament.
- Measure context ownership, upload/readback count, frame time after warmup, memory use if measurable, startup and visual output on **real browsers**.
- Repeat native desktop GPU scenes with appropriate renderer backends; verify no incompatible state ownership.
- Publish a pass/fail matrix with failure logs and license audit, then choose components to vendor with full source and attribution.

## Reproducing

`sources.json` fixes the revisions; run the GitHub workflow manually or on the experiment branch to exercise an identical scenario. Host packages and external Rust dependencies are **not yet hermetically pinned**, so reproducibility is partial and clearly labeled.

Skia build source instructions: https://docs.skia.org/docs/user/build/

Filament build source instructions: https://github.com/google/filament/blob/main/BUILDING.md

Vello CPU example source: https://github.com/linebender/vello/blob/main/vello_cpu/README.md

## Verified isolated browser composition — animated 3D cube + 2D overlay

The additional [Chromium source-artifact replay](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38219202232)
passed on 2026-10-12. It rendered a **true 3D, 24-vertex cube with perspective and animated
transform in Filament**, and overlaid genuine Vello CPU WebAssembly pixels in a separate
transparent 2D canvas. Evidence includes paired initial/final screenshots, pixel checks,
the actual browser runtime log and DPR 1 / DPR 2 machine-readable reports.

Read [the measured test report](results/browser-cube-proof.md) before relying on this result.
In particular, this verifies browser DOM compositing, **not** shared WebGL GPU resources,
Vello GPU rendering, color-management parity, real-GPU throughput, or desktop integration.
The sources are still fetched in compatibility builds; no engine has been adopted or vendored.

## Latest browser composition comparison

[Verified 2D-only vs 3D-only vs mixed browser measurements](results/browser-composition-comparison.md)
from [run 38230352604](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38230352604).
All 9 isolated test cases passed (2160 frames). Measurements use SwiftShader,
static Vello CPU pixels and separate canvases: no hardware GPU or shared context claim.

## Per-frame 2D/3D upload pressure

[Verified dynamic 2D overlay performance probe](results/browser-dynamic-overlay.md)
completed in [run 38231641598](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38231641598).
The full Vello CPU reraster/upload each frame caused repeated delayed RAF callbacks
alongside Filament on SwiftShader; cached 2D motion did not. This is **not a hardware GPU
benchmark** or proof of shared contexts. The final rendering-engine decision remains open.

## Pixel-exact real vector geometry dirty-region test

[Verified Vello changing-vector dirty-region benchmark](results/browser-geometry-dirty.md):
all 15 cases passed (2700 frames), final full-frame RGBA output byte-identical
in both drawing strategies. [CI run 38234646339](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38234646339).
The result concerns only Vello CPU-WASM and the separate Canvas2D/WebGL2
software-composited experimental browser pathway, not actual GPU memory or throughput.

## Antialiased Bézier geometry with overlapping dirty rectangles

[Verified 21-case complex vector clip benchmark](results/browser-complex-dirty.md)
from [CI run 38242292443](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38242292443).
Dirty union CPU frame work p95 was 6.7ms vs 14.8ms for full redraw in mixed
SwiftShader tests, but independent AA rasters differed by up to **1/255** per
RGBA channel at sparse edges. **Not** bit-identical and **not** hardware GPU evidence.

## Antialiasing precision with padded dirty regions and transforms

[Verified Vello pixel-stage AA analysis](results/browser-aa-precision.md): 18/18 browser
cases across six transforms and three fresh contexts. 0/8/16/32px padding
never achieved byte-exact equality; raw premultiplied pixels already differ
slightly, with maximum channel deviation 1/255. No claim of hardware GPU
performance or a final renderer selection.

## Single-path antialiasing origin diagnosis

[Verified Vello AA origin experiment](results/browser-aa-origin-trace.md):
24/24 browser cases in [run 38247153296](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38247153296).
Independent single filled Bézier paths already show sparse 1/255 alpha differences;
integer-aligned rectangles do not. The two Vello CPU fine-compositing precision
modes produce identical discrepancy counts. Flatten/strip coverage is the next
investigation target. No GPU performance claims, no main merge.

## Source-stage AA and flatten trace

[Verified prequantized coverage and flattened-geometry trace](results/browser-aa-coverage-internals.md):
[4/4 independent browser cases](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38250617769) passed.
Every one of 55 observed alpha differences (per round) was present in the
actual pre-u8 Vello strip mask, with differing flattened f32 line coordinates.
Precise arithmetic attribution and a universal pixel-exact solution remain open.
Upstream patches exist only in the temporary source-build experiment.

## Canonical global flattening: verified exactness in isolated fills

[Verified Vello CPU global-flatten proof](results/browser-aa-global-flatten.md):
[6/6 expanded-ROI browser tests](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38252702790) succeeded.
For the sampled full-frame versus three independently rerasterized dirty regions,
**453 baseline differing RGBA channels became zero** (per browser context).
Runtime medians were 0.3ms for both partial strategies on this runner.
This is a fixed 800x500 experimental scene with filled paths only; it is not a
general clipping/damage solution or real-GPU evidence. No main merge.

## Extended affine / strokes / freeform clipping regression

[Verified 72/72 Vello CPU byte-exact cases](results/browser-aa-transform-stroke-clip.md):
three canvas sizes, three transforms and four path/clip modes, in two isolated
browser contexts, run [38256072097](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38256072097).
Canonical global flattening: 0 changed channels; previous local-first control:
14,600 differences across both passes. The source-built pinned proof handles
stroked paths and canvas dimensions dynamically, with unchanged full-frame
reference. CPU-only browser evidence; not a production renderer or main merge.

## Strict full dirty-region edge cases

[Verified 144/144 Vello CPU edge cases](results/browser-aa-edge-boundaries.md):
[run 38257662189](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38257662189).
Nested freeform clips, offscreen geometry spanning canvas boundaries, and strong
fractional affine transforms on three canvas sizes remained byte-exact across
**every pixel in each independent dirty rectangle**. Previous local-first control:
10,846 changed RGBA channels over both contexts; global flatten: zero.
CPU-side proof only; no GPU inference, no production adoption, no main merge.

## Layered opacity/blend and sequential repaint verified

[Verified Vello CPU layered repaint experiment](results/browser-aa-layered-repaint.md):
[30/30 cases passed](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38264971384).
Nested opacity groups, Multiply/Screen/Overlay blend and irregular clip pass full
RGBA tile parity: baseline 1,032 changed channels, canonical zero. Independently
rendered dirty tiles were copied onto actual prior-frame RGBA buffers across
180 transitions (540 tile renders), always matching full-frame reference.
Damage bounds here use full-image pixel differences (oracle), NOT a production
invalidator. Browser software-CPU WASM only, with no GPU or main merge.
