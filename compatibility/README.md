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
