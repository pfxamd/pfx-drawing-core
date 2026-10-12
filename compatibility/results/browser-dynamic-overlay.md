# Per-frame 2D updates alongside animated Filament 3D

**Status: not yet verified by GitHub Actions.**

This experiment extends the previously verified
[isolated-vs-mixed browser benchmark](browser-composition-comparison.md)
without changing production code, engine source revisions, PFx Geometry Core or `main`.

## Controlled cases

All cases render at 800 × 500 logical pixels inside headless Chromium. 3 cycles of 6
fresh browser contexts (18 cases, 180 animation callbacks each, 3240 frames total):

1. `3d-only`: continuous Filament moving cube, Vello not loaded.
2. `mixed-static`: same moving cube plus single, stationary Vello overlay.
3. `mixed-cache-motion`: same moving cube plus a moving Canvas2D transform of
   a **cached** actual Vello CPU-WASM image, no further Vello raster or image upload.
4. `mixed-reraster-motion`: same moving cube plus **fresh Vello CPU-WASM
   rasterization**, new RGBA buffer copy, full `putImageData`, and moving
   overlay Canvas2D draw in **every animation frame**.
5. `2d-cache-motion`: cached motion without Filament.
6. `2d-reraster-motion`: frame-by-frame Vello redraw/upload/motion without Filament.

The order is counterbalanced across three rounds, all independently initialized.
2D-only must not fetch Filament, and 3D-only must not fetch Vello. Off-origin browser
requests fail. Tests assert expected number of 2D renders, RGBA transfer bytes,
source alpha, visible 2D overlay in moving location, 2D visual change, moving 3D
geometry, absence of runtime errors, no unintended context loss and complete frames.

## Actual measurement boundaries

- Vello renders the **same static vector primitives each time**. The resulting real
  2D image is moved via Canvas2D translation. The experiment establishes continuous
  *rasterization + copy + Canvas2D upload* cost; it does **not** establish rendering
  performance for independently edited / animated Vello vector paths.
- The 800 × 500 uncompressed RGBA buffer is 1,600,000 bytes. Vello's WASM->JS
  transfer and `putImageData` are both measured on the calling CPU thread.
- Report separately: 2D WASM raster call, pixel copy/ImageData creation,
  Canvas2D upload call, overlay clear/draw calls, Filament CPU submission,
  total CPU work inside requestAnimationFrame, callback intervals, and count of
  callback intervals over 24 ms. Save JS heap at warmup and finish.
- None of these measure GPU completion, GPU memory, browser compositing time, or
  a real hardware GPU. The test uses Linux headless Chromium with SwiftShader,
  separate browser-managed 2D and WebGL2 canvases, and source-built WASM replay
  from [run 38183319164](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38183319164).
- 2D and mixed cases have inherently different GPU workloads; comparisons indicate
  exploratory costs only, not causal GPU composition overhead.
- No architecture selection, performance SLA, WebGPU backend, Vello GPU raster,
  shared GPU context, desktop performance or production readiness follows.

The authoritative metrics are the CI-published `dynamic-overlay-summary.json`
and all individual screenshots / JSON reports.
