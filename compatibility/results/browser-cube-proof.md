# Browser 2D/3D integration proof — verified 2026-10-12

## Provenance

- **GitHub Actions:** https://github.com/pfxamd/pfx-drawing-core/actions/runs/38219202232 — successful completed run.
- **Evidence artifact:** https://github.com/pfxamd/pfx-drawing-core/actions/runs/38219202232/artifacts/11733752218
- **Source-built engine artifacts replayed from:** https://github.com/pfxamd/pfx-drawing-core/actions/runs/38183319164
- **Test code:** `experiment/browser-cube-proof`; `compatibility/browser/web/compose.js` and `compatibility/browser/test-cube.cjs`.
- **Engines:** pinned Vello `235739c4f08eb48d900e1512459d453a9ab77f96` (CPU WASM) and Filament `764fe6cac9bdb4ba24d3d852344dfa04a5f70f75` (WebGL2 WASM). This replay reused compiled build outputs from the successful source-build CI, not a CDN at browser runtime.

## Observations from real headless Chromium (SwiftShader WebGL2)

| Asserted / measured result | DPR 1 | DPR 2 |
|---|---:|---:|
| Image pixels | 800 × 500 | 1600 × 1000 |
| Vello loaded and drew RGBA overlay | PASS | PASS |
| Filament loaded and rendered a 24-vertex / 36-index cube | PASS | PASS |
| Perspective camera and changing transform | PASS | PASS |
| Frames observed | 45 | 50 |
| Opaque white RGBA | [255,255,255,255] | [255,255,255,255] |
| Overlay magenta RGBA | [255,0,255,255] | [255,0,255,255] |
| Source transparent alpha | 0 | 0 |
| Magenta pixels composited in center over 3D scene | PASS | PASS |
| Changed samples between captured frames (3 px grid) | 5215 | 5103 |
| Non-background samples in scene ROI | 4544 | 4611 |
| JavaScript / page errors | 0 | 0 |
| HTTP(S) runtime requests outside local origin | 0 | 0 |
| Vello render call (ms, observed) | 11.4 | 9.5 |
| Filament ready, relative to script startup (ms, observed) | 196.7 | 173.1 |
| Filament renderer *CPU call* duration p95 (ms) | 2.6 | 0.4 |
| Animation callback interval p95 (ms) | 16.7 | 16.8 |

The evidence ZIP includes four screenshots and two JSON reports. The screenshots were inspected after download: a visible colored cube has multiple faces, and original Vello output overlays its visible foreground. The changing frame pixel samples demonstrate actual movement.

## What has **not** been proven

- This is **two independent canvases composited by the browser**, not shared GPU context / texture interoperability.
- Vello uses its CPU WASM rasterizer with an RGBA upload to HTML Canvas2D. No Vello WebGPU backend was rendered in this experiment.
- Filament's WebGL2 backend ran on **software SwiftShader**; call time measurements exclude asynchronous GPU work and are **not** reliable GPU benchmarks or comparative performance scores.
- DPR 2 proves the two canvases visually compose at browser device scaling; it does **not** prove resolution-independent source raster output or retina-quality backing buffers.
- No long-running stress test, complex 3D PBR lighting, large-document/vector workload, simultaneous editing workloads, native-desktop compositing, color-profile tests, memory bandwidth analysis or GPU resource-sharing optimization.
- License and transitive dependency audit, source vendoring and fully hermetic builds remain outstanding.
- No engine selection, production approval, or merge into the PFx core follows from this proof.

**Next gate:** compare compositing cost and memory on real GPU hardware, exercise dense mixed 2D/3D scenes, test native desktop, and perform complete license/dependency audits before choosing a rendering architecture.
