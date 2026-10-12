# Browser stability and observational performance gate

This experiment extends the verified Vello CPU-WASM transparent overlay plus Filament
WebGL2 perspective cube from [run 38219502922](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38219502922).
No final engine selection or changes to PFx Geometry Core or `main`.

## Scope

Workflow: `.github/workflows/browser-stability-performance.yml`
Script: `compatibility/browser/test-stability.cjs`
Source revisions: `compatibility/sources.json`.

Reuses original *source-built* Vello and Filament browser outputs from
[run 38183319164](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38183319164).
Compiled outputs are downloaded **during CI preparation**, then all browser requests use a
local server; off-origin HTTP requests are blocked and reported.

4 fresh browser contexts are opened sequentially within one headless Chromium process:

| Experiment | Device pixel ratio | Frame target | 2D visible |
|---|---:|---:|---|
| Long mixed render | 1 | 420 | yes |
| High-DPR composition | 2 | 300 | yes |
| Overlay-hidden comparison | 1 | 300 | no |
| Renderer re-creation | 1 | 180 | yes |

Every case checks frame completion, both engine states, true cube motion in two screenshots,
source alpha, browser pixel scaling, unexpected context loss, console and page errors,
and forbidden off-origin requests. Reports capture 3D CPU submission p50/p95/p99,
animation callback interval p50/p95/p99, single Vello CPU raster call time,
Canvas2D putImageData call time, Filament startup, Chromium CDP JavaScript heap before
and after a running interval, screenshots and errors. Failures retain partial evidence.

## What measurements cannot establish

- The workflow uses **SwiftShader** software WebGL2. It does **not** establish real GPU performance.
- Filament `renderer.render()` wall time is CPU-side submission, **not completed GPU time**.
- Animation callback intervals can reflect Chromium/runner scheduling and are not GPU timestamps.
- CDP JavaScript heap excludes WASM linear memory, driver, GPU, browser-process and OS memory;
  heap changes within one run are not evidence for/against long-term leaks.
- Hidden HUD still runs Vello generation and upload; the sequential conditions have different
  durations. This is an exploratory comparison, **not isolated compositor overhead**.
- DPR 2 screenshots are device-scaled; underlying canvas backings remain 800×500.
- Browser context recreation is not recovery from intentional device/context loss.
- No shared GPU textures/contexts, native-desktop compatibility, real-GPU memory bandwidth,
  full browser matrix or licensing acceptance is proven.
- Build artifacts are replayed to avoid repeating the expensive proven builds. Reproducibility
  remains limited by non-hermetic build dependencies and CI environment.

The workflow's downloadable `stress-summary.json` is authoritative for measured values.
## Verified execution — 2026-10-12

- **GitHub Actions run:** [38224305608](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38224305608) — completed **SUCCESS**.
- **Machine-readable measurements, 4 browser screenshots:** [artifact 11735323969](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38224305608/artifacts/11735323969).
- **Code commit tested:** `bfb6890864c16e1239733b22f5467f377a6192ee`.
- All **4 / 4** scenarios passed and the source-built runtime completed **1200 / 1200** requested animation frames.
- No JavaScript/console errors, unexpected WebGL context loss or external browser-origin requests were recorded.
- Screenshot motion checks detected 2249, 2195, 2328 and 2653 changing sample points, respectively. Shown-overlay screenshots contain visible Vello painting over the moving Filament cube.
- Chromium reports `WebGL 2.0 (OpenGL ES 3.0 Chromium)`, backed by SwiftShader on the CI runner.

| Scenario | Frames | Render CPU call p95 | Callback interval p95 | Single Vello raster call | Canvas2D upload call | JS heap delta* |
|---|---:|---:|---:|---:|---:|---:|
| DPR 1 overlay shown | 420 | 1.0 ms | 16.7 ms | 10.8 ms | 12.6 ms | +1,018,508 B |
| DPR 2 overlay shown | 300 | 0.6 ms | 16.7 ms | 8.5 ms | 4.0 ms | -224,720 B |
| DPR 1 overlay hidden | 300 | 0.7 ms | 16.8 ms | 6.4 ms | 2.9 ms | +715,900 B |
| DPR 1 recreated context | 180 | 1.0 ms | 16.8 ms | 7.0 ms | 3.5 ms | -532,900 B |

*JavaScript-heap difference between a sample after about 40 frames and the end of that scenario.
Differences include garbage collection and warmup effects and **do not establish a memory leak
or absence of one**. Measurements are from a single run on a shared runner; no confidence
intervals or cross-engine relative benchmarks can be inferred.

The screenshot and JSON artifacts were downloaded and examined following the successful run.
The source-built 2D/3D composition is stable **for the tested short-duration SwiftShader
conditions only**. The engines remain unselected. Tests on real GPUs, full process/GPU
memory and compositor overhead isolation are next experimental gates.

