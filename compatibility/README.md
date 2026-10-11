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
