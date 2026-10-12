# Per-frame 2D updates alongside animated Filament 3D

## Verified browser outcome — 2026-10-12

- [GitHub Actions run 38231641598](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38231641598) — **SUCCESS**, no hidden test failures.
- [37-file evidence artifact 11739545018](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38231641598/artifacts/11739545018) — 18 screenshots, 18 JSON run measurements, one aggregate JSON.
- Tested commit: `4e87fb65084592faa47b1a53bdfde01915e50de7`.
- **18 / 18 scenarios passed, 3240 / 3240 animation frames**. Assertions include independent
  2D/3D loading, Vello alpha, moving 2D pixels, moving Filament cube, proper RGBA
  upload counts, external traffic isolation, and unexpected WebGL context losses (zero).
- Real `r3-mixed-reraster-motion.png` was opened and inspected after extracting the CI
  artifact. The rendering shows Vello magenta and white painting correctly overlapping
  the Filament perspective cube.

**Aggregates:** median of per-scenario p95 values across 3 runs in the **software-rendered** CI browser.

| Workload | Frames | Whole-frame CPU work p95 | RAF callback interval p95 | Vello raster call p95 | Upload call p95 | Intervals >24 ms |
|---|---:|---:|---:|---:|---:|---:|
| 3D only | 540 | 0.9 ms | 16.8 ms | — | — | 3 |
| 3D + static Vello | 540 | 1.5 ms | 16.8 ms | 6.7 ms (initial) | 2.9 ms (initial) | 3 |
| 3D + cached moving Vello | 540 | 0.5 ms | 16.7 ms | 6.9 ms (initial) | 2.8 ms (initial) | 3 |
| 3D + full Vello reraster/upload every frame | 540 | 11.4 ms | **50.0 ms** | 6.3 ms | 2.2 ms | **132** |
| 2D cached motion only | 540 | 0.2 ms | 16.8 ms | 8.2 ms (initial) | 2.9 ms (initial) | 0 |
| 2D full reraster/upload every frame | 540 | 8.2 ms | 16.8 ms | 5.7 ms | 0.3 ms | 2 |

The moving, fully rerasterized mixed case invoked Vello **543 times** and issued
**543 full 1.6 MB RGBA uploads** across 3 runs: **868,800,000 bytes** in total
(count includes each scenario's first static initialization image).
Each of the three runs had 28–56 intervals above 24 ms, so the long callback gaps
were observed repeatedly and were not a single one-off outlier.

**Interpretation:** continuously regenerating/uploading the unchanged Vello source
painting adds nontrivial CPU work, and the *combined* SwiftShader software workload
exhibited substantially longer animation callback intervals than either cached motion
or 2D-only regeneration in this small CI sample. The tested static and cached strategies
showed no comparable recurring stalls. This identifies the **per-frame full-frame
CPU raster → copy → Canvas2D upload path as a performance risk** under the tested
conditions. It does *not* identify the underlying GPU compositor as the cause:
WebGL2 is software-rendered, Chromium scheduling may interfere, the source image
is not vector-animated, and direct browser-compositor/GPU measurements were not taken.

**Next gate:** update actual Vello geometry each frame and test partial dirty regions,
then verify GPU device workload, timing, full memory and composition on real hardware
before comparing candidate architectures. None of these experiments selects or approves
an engine or warrants a merge to the main branch.


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
