# Full-region AA edge-boundary stress test — nested clipping, offscreen winding and strong transforms

## Verified result — 2026-10-12

- [Successful source-build and browser run 38257662189](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38257662189): both jobs completed successfully.
- **144/144 full-region pixel-parity cases PASS; 0 mismatched RGBA channels** for canonical global flattening.
- [Browser proof and screenshot](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38257662189/artifacts/11751226148): aggregate JSON, six detailed context/canvas JSON files and an actual Chromium screenshot.
- [Pinned-source WASM and patch/build logs](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38257662189/artifacts/11751370762).
- The original local-first control produces **10,846 mismatched channels** over both repeated passes (maximum deviation handled by comparison; all canonical comparisons require strict zero).
- No merge into `main`, no adopted production drawing renderer and no native/GPU performance claim.

## Exact test contract

The experiment preserves the pinned Vello CPU source revision `235739c4f08eb48d900e1512459d453a9ab77f96`, and source-compiles its temporarily patched geometry pipeline into WASM. No runtime network service is necessary. The corrected canonical path flattens Bézier geometry in a fixed global scene frame before rebasing the f32 segments to a smaller local raster target, including filled and stroked paths.

This stress test adds two edge geometries to the existing 72-case suite:

- **Nested freeform clips:** an additional curved clip path is pushed inside another, then popped in reverse order. Test suites include both filled and stroked contours, and an overlapping offscreen contour.
- **Offscreen winding:** filled closed Bézier paths have control points and contour segments above, below, left and right of the full canvas. Some parts intersect the canvas and/or are clipped by the two nested clips.

Compared against the separately rendered *full-frame* image, with no image masking, copying reference data into the tile, or compositing bypass:

- Canvases: **640×400**, **800×500**, **1024×640**.
- 6 independent scene families: nested clipped fills (flags 13), nested clipped fills + stroke (15), offscreen contours (16), offscreen + stroke (18), nested clipped offscreen contours (28), and a combination of all features (31).
- 4 affine transform families: identity; zoom 0.5 with rotation 0.58 radians and fractional offset; zoom 1.95 with rotation −0.72 radians and fractional offset; zoom 1.08 with rotation 1.12 radians and fractional offset.
- Frames: **0 and 43**.
- Three different *independently rerendered* dirty rectangles per canvas. **All pixels of each rectangle**, from first to last row and column, are compared, not merely the common intersection.
- Two fresh browser contexts, reversing the canvas and scene order in the second context.
- Total: **3 canvases × 6 scene families × 4 transforms × 2 contexts = 144 test cases**, with 2 frames and 3 dirty rectangles compared in each case.
- **118,579,200 pixel comparisons per render variant**, or 474,316,800 individual RGBA-channel comparisons per variant. Repeated render samples of different scenes/frames/regions are counted separately, not as unique pixels.

In each case the full scene was rendered with canonical mode both enabled and disabled, establishing that the full reference output was unchanged. Cases also record whether actual colored pixels are exercised, and the comparison fails rather than skipping non-exact results.

## Verified strict RGBA results

The following numbers count mismatched RGBA *channels* over one context/canvas pass, aggregated across the scenes, transforms, frames and 3 dirty regions; the second independent context repeated the exact same counts.

| Canvas | Cases | Original local-first mismatched channels | Global-flattened mismatched channels |
| --- | ---: | ---: | ---: |
| 640×400 | 24 | 756 | **0** |
| 800×500 | 24 | 2,099 | **0** |
| 1024×640 | 24 | 2,568 | **0** |
| **All three sizes, one context** | **72** | **5,423** | **0** |
| **Both browser contexts** | **144** | **10,846** | **0** |

No changed premultiplied RGBA channel remains in the canonical results. The original local-first implementation remains independently available and still reproduces the expected sparse deviations. The cases have actual nontransparent pixels, including strong transforms and offscreen geometry.

## CPU-only WASM render-call timings

18 measured calls per comparison path per canvas/context, after warmup; scene 31 (all combined) under zoom 1.95 and rotation −0.72. The browser used a headless software backend; values are rounded medians in milliseconds:

| Canvas | Full frame | Local dirty rectangle | Canonical dirty rectangle |
| --- | ---: | ---: | ---: |
| 640×400 | 1.5 | 0.8–0.9 | 0.8–0.9 |
| 800×500 | 2.4 | 1.3 | 1.2 |
| 1024×640 | 3.5–3.6 | 1.5 | 1.5 |

Per-run p95 values and allocation sizes are retained in the JSON evidence. No broadly generalizable speedup or GPU data transfer reduction is established. Timings exclude browser paint and hardware GPU.

## Files and next verification boundary

- `compatibility/browser/vello-complex/src/lib.rs`: opt-in nested clip and offscreen geometry controlled by scene flags; old exports preserved.
- `compatibility/browser/test-aa-edge-boundaries.cjs`: strict, entire-region RGBA comparison, scene metadata and timing.
- `.github/workflows/browser-aa-edge-boundaries.yml`: pinned upstream source-build plus reproducible Chromium proof.
- The upstream source patch and global geometry metadata remain under `compatibility/browser/aa-coverage-internals/`, in a temporary source-built experiment. No upstream repository or main-branch change.

**Not yet verified:** arbitrary dirty-region unions/invalidation sequences; deeply nested opacity and blend layers; gradient and image paints; path self-intersections; large geometric coordinates/overflow; text rendering; multiple SIMD backends; GPU/Filament composition; desktop-native execution; automated damage detection. The global-flatten correction is a successful scoped numerical experiment, not universal proof or an integrated final rendering engine.

## Decision

Retain the canonical global-flatten approach as an isolated candidate. For the next gate, evaluate **layer isolation, blend modes and multi-tile dirty repaint sequences** while keeping unchanged 2D/3D integration boundaries. No `main` merge.
