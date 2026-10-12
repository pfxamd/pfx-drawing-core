# Extended Vello CPU global-flatten experiment: transforms, strokes, clipping, canvas sizes

## Verified outcome — 2026-10-12

- **Source-built pinned Vello CPU WASM:** [build run 38255408097](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38255408097), compiler job **successful**. It reproduces pinned upstream Vello revision `235739c4f08eb48d900e1512459d453a9ab77f96` and applies an explicit temporary source patch.
- **Corrected browser verification:** [run 38256072097](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38256072097), **72/72 byte-exact test cases PASS**, 0 canonical differences. [Machine-readable evidence and real browser screenshot](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38256072097/artifacts/11749663089).
- The initial browser job in run 38255408097 failed on a test-only JavaScript lexical name shadow (`performance` defined before initialization). The corrected browser workflow replays the **same source-built WASM**, with exact Git source blob guards. Do not confuse this test-harness failure with a renderer failure.
- The baseline local-first strategy still produces sparse differences. **The new canonical strategy eliminates all measured differences** across the selected scenes, transforms, and viewport sizes in the compared dirty-region intersections.
- No modification to `main` or selection of a finished drawing renderer.

## Tested source modification

The global-space flatten experiment is extended to:

1. Filled Bézier paths via `StripGenerator::generate_filled_path`.
2. Stroked Bézier paths via `StripGenerator::generate_stroked_path`, including join and cap construction by pinned upstream code.
3. Freeform path clipping using the existing Vello clip machinery, without bypassing it.
4. Viewport sizes passed to `pfx_trace::begin_extended`, used in the **global** flatten/cull bounds instead of the prior hard-coded 800×500 rectangle.
5. Zoom, rotation and fractional translations, applied in the same global scene coordinates before local region rebase.

The experimental implementation computes globally consistent flattened `f32` line segments for a full scene (same global culling bounds), then subtracts the dirty origin from the flattened line endpoints before feeding the ordinary local tile/strip/raster stages. The original local-first rendering path remains directly callable as the control.

**This branch is a test-only adaptation of upstream Vello CPU**, not an adopted production core. Geometry is limited to the explicitly tested paths and clips.

## Strict pixel comparison

- Canvases: **640×400**, **800×500**, **1024×640**.
- Four scene families: Bézier fills; thick Bézier stroke; freeform-clipped Bézier fills; freeform-clipped combination of fills and stroke.
- Three global transforms: identity; zoom 1.08 plus subpixel translation (+0.375, −0.625); zoom 0.93 plus rotation 0.09 radians and translation (−0.25, +0.5).
- Frames: **0, 43, 159**.
- **Three separately rendered dirty regions per case**, each compared pixel by pixel, **all four premultiplied RGBA channels**, against independent full-frame rendering within the regions' common intersection.
- Two independent browser contexts with reversed scene/size execution order: **3 sizes × 4 scenes × 3 transforms × 2 contexts = 72 case runs**.
- Every case exercises 3 frames and 3 independent dirty regions. The strict gate requires **zero differences**; it does not accept the old 1/255 tolerance. Controls also confirm that global canonical and global original reference output remain bit-for-bit identical.
- Across the six browser context/canvas combinations there are **80,510,976 compared RGBA pixels (322,043,904 channel comparisons)**. These are repeated comparisons, not distinct pixels or unique frames.

### Results

Counts below are mismatched channels aggregated across all scenes, transforms, frames and regions **within one browser context for each canvas**. All counts reproduced identically in the second context.

| Canvas | Cases per context | Baseline local-first mismatched channels | Canonical global-first mismatched channels |
| --- | ---: | ---: | ---: |
| 640×400 | 12 | 1,530 | **0** |
| 800×500 | 12 | 2,885 | **0** |
| 1024×640 | 12 | 2,885 | **0** |
| **Per complete three-size pass** | **36** | **7,300** | **0** |
| **Both passes** | **72** | **14,600** | **0** |

All 72 case results were byte exact within the selected common dirty-region intersection. The evidence file includes per-case and per-frame counts and records any non-exact channels rather than hiding them.

## Browser-side CPU timing

Measured only for the most complex clipped fill-and-stroke scene under combined rotation and zoom, with **18 interleaved synchronous WASM samples per path per browser context**, after warmup. Rounded approximate medians from the two browser contexts:

| Canvas | Whole frame | Original local region | Canonical region |
| --- | ---: | ---: | ---: |
| 640×400 | 1.2 ms | 0.6 ms | 0.6–0.7 ms |
| 800×500 | 1.9 ms | 1.0 ms | 1.0 ms |
| 1024×640 | 2.7–2.8 ms | 1.1 ms | 1.1 ms |

These measurements do **not** establish universal performance parity or an engine-wide speedup. They exclude full-page composition, data uploads, thread scheduling, native GPU acceleration, and the full 2D/3D frame.

## Evidence and reproduction

- Instrumented `vello_common` patch: `compatibility/browser/aa-coverage-internals/patch-upstream.cjs`.
- Canonical global scene metadata: `compatibility/browser/aa-coverage-internals/pfx_trace.rs`.
- Browser-facing variable viewport/stroke/clip export: `compatibility/browser/vello-complex/src/lib.rs`.
- Strict comparator: `compatibility/browser/test-aa-transform-stroke-clip.cjs`.
- CI source build + source-guarded WASM replay: `.github/workflows/browser-aa-transform-stroke-clip.yml`.

No network dependency at runtime; upstream Git access in CI is only for building the pinned experimental WASM. Headless Chromium uses a software backend. The geometry test is CPU-side only.

## Remaining limitations

- Only the **common intersection** of the manually selected dirty rectangles is compared, not every pixel in every entire dirty rectangle. This does not prove a complete dirty-region damage algorithm or clipping at arbitrary viewport boundaries.
- Sampled path geometry, scenes, affine transforms and frames are finite test cases, not mathematical proof of universal byte-exactness.
- Source integration remains a temporary, pinned-Vello experiment. Clips, nested layers, other scene sizes, fonts, text glyphs, gradients, image paints, multiple SIMD targets, extreme transforms and degenerate paths need independent tests.
- No physical GPU performance, Filament device/context integration, actual GPU transfer reduction, shared Vello/Filament render passes, or native desktop backend established.

**Decision:** The generalized-origin method is supported for advancing to additional independent failure-boundary tests. Keep it out of `main` until the full scope is verified.
