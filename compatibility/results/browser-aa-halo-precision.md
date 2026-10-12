# Verified Vello CPU 4-pixel source phase and 16-pixel Gaussian halo

## Reproducible results — 2026-10-12

- [Pinned Vello CPU source build](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38275299670): upstream revision `235739c4f08eb48d900e1512459d453a9ab77f96`. Actual source-built WASM reused under exact Rust/Cargo/patch/trace/HTML Git blob guards; upstream and `main` remain unchanged.
- [Unaligned halo and source-phase browser sweep](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38279861228): **PASS**, includes negative cases and strict byte-precise evidence.
- [Sequential source-halo dirty repaint](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38280137636): **PASS**.
- [Independent actual source-area instrumentation](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38280598578): **PASS**, six independent Chromium canvas/context runs and JSON evidence.

## Root-cause boundary revealed by tests

The previous near-singular/miter/mask/filter experiment used full-frame fallback after deliberately split dirty tiles produced **1–2 changed RGBA channels**, even though geometric damage bounds did not miss any changed pixels.

A naïve source halo **without source-grid alignment** still produced 1/255 mismatches at some tile origins with padding up to 128 pixels, and larger changes under actual Vello CPU Gaussian filter layers. Changing only the source-origin phase to a global multiple of 4 eliminated sampled sharp-miter and mask differences. For Gaussian blur, a 4-pixel globally aligned source plus a **16-pixel surrounding input halo** eliminated all differences in the expanded test set. This strongly implicates the 4×4 strip-grid phase and filter-source extent; the precise internal numerical instruction responsible is **not yet proven** by a stage-by-stage trace.

Global f64→f32 canonical Bézier flattening from the earlier source patch remains enabled and is unchanged in this experiment. The new strategy makes the **local source raster bounds** phase-consistent with a separately rendered full canvas, then crops only the requested dirty rectangle. It does not copy reference pixels into the test tile.

## Byte-exact independent ROI comparisons

Three canvases (**640×400**, **800×500**, **1024×640**) × two browser contexts; six difficult scenes (near-singular sharp miter, isolated alpha mask, Gaussian blur, masked Gaussian blur); **180** separately rasterized dirty ROI comparisons, including previously failing four-way grid origins. Every ROI pixel and all 4 RGBA channels were compared exactly.

| Scene | ROI checks | Unaligned source changed channels | 4-pixel source alignment, no halo | 4-pixel alignment + 16px halo |
| --- | ---: | ---: | ---: | ---: |
| Near-singular miter | 30 | 8 | 0 | **0** |
| Alpha mask | 30 | 4 | 0 | **0** |
| Gaussian blur | 60 | 245,532 | 80 | **0** |
| Masked Gaussian blur | 60 | 229,802 | 16 | **0** |
| **Total** | **180** | **475,346** | **96** | **0** |

A broader, **different** naïve-halo origin/scene matrix also found 661,502 changed channels; those two baselines must not be directly compared.

## Actual sequential dirty repaint

`compatibility/browser/boundary-effect-halo-damage.cjs` estimates conservative old+new damaged rectangles from the actual affine-transformed Bézier controls, miter width, and 24 extra filter-invalidation pixels. **Full reference pixel differences are NEVER used for damage planning**. A 16px source halo is added at draw time and the source origin/end snapped to the global 4px grid. Two distinct prior-frame RGBA caches are updated through each 13-frame-transition sequence: direct damage rectangles and four overlapping dirty subdivisions. A reference full scene is rendered separately and used only for strict post-hoc verification.

Across all canvases and two contexts:

| Measure | Verified |
| --- | ---: |
| Transitions | **78** |
| Changed full-reference pixels | **1,376,266** |
| Changed pixels missed by geometric invalidation | **0** |
| Actual target-tile draws | **360** |
| Actual expanded-source renders **smaller** than the canvas | **354** |
| Actual expanded-source renders equal to the full canvas | **6** |
| Truly partial expanded-source renders with Gaussian effect | **120** |
| Canonical source-tile RGBA mismatches | **0** |
| Complete accumulated frame RGBA mismatches | **0** |
| Total padded source pixels requested | **60,135,264** |
| Total dirty target pixels pasted into caches | **55,027,088** |

The padding area counts are from the **actual source rect requested from pinned WASM**, not just the smaller dirty rectangle. Both independent replay layouts are included, one with deliberate overlaps. The test **does not establish faster total rendering**: total area processed across overlapping tiles may be greater than a full-frame redraw, and no hardware GPU or actual real-editor latency was measured.

## Files

- `compatibility/browser/test-aa-halo-precision.cjs` — native unaligned-halo falsification over many ROIs.
- `compatibility/browser/test-aa-grid-phase.cjs` — isolate 4px strip-grid origin phase and 16px blur halo over all 180 scene/ROI checks.
- `compatibility/browser/boundary-effect-halo-damage.cjs` — command-derived invalidation without forced filter full-frame fallback.
- `compatibility/browser/test-aa-grid-repaint.cjs` — real expanded-source WASM rasterization, caching, strict per-channel full-frame oracle, and source-area counts.
- `.github/workflows/browser-aa-halo-precision.yml` and `.github/workflows/browser-aa-grid-repaint.yml` — browser proofs against the exact source-guarded prior WASM artifact.

## Scope and next gates

These results are **empirical and filter-specific**, not a universal proof for arbitrary blur sigma/kernel, graph of filters, transformed shadow, miter cap, mask path, native CPU SIMD, GPU, or Filament/3D mixed compositor. A production halo policy must derive each filter's source expansion and preserve its phase; if outside a proved contract, fall back to a complete frame.

Next evaluate randomized affine transforms, various blur radii and scene origins, then gather stage-by-stage float coverage and source-filter-layer diagnostics to causally confirm the 1/255 mechanism. No change to `main` or production drawing core.
