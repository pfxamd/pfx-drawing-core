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
**Status: pending CI results until the new run completes.**
