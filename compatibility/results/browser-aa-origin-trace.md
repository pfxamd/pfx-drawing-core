# Vello CPU antialiasing origin trace — isolated path coverage

## Verified outcome — 2026-10-12

- [Successful browser run 38247153296](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38247153296): **24/24 scenarios passed**, six independently selected scenes × two Vello CPU compositing pipelines × two fresh Chromium contexts.
- [26-file evidence artifact 11746192951](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38247153296/artifacts/11746192951): one JSON per scenario, aggregate JSON and screenshot. Individual JSONs include origin comparisons, per-frame RGBA differences, timing arrays, and example coordinates.
- The actual upstream-pinned Vello CPU WASM was built successfully in the first job of [run 38246676286](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38246676286), using Vello upstream SHA `235739c4f08eb48d900e1512459d453a9ab77f96` and the `f32_pipeline` feature. The initial browser job failed only because its legacy straight-alpha export was incorrectly compared to a raw premultiplied buffer. The test was corrected, then run 38247153296 replayed the identical source-built WASM. The legacy output subsequently compared **byte-identically (0 deviations)** with the new matching straight-alpha diagnostic entrypoint.

## Controlled method

The fixed comparison ROI is (464,112,312,232). Reference: independently rendered full 800×500 frame. Tile origins: original (448,96), plus one (449,97), plus eight (456,104), minus four (444,92), minus sixteen (432,80). Every region contains the ROI. Frames sampled: 0, 43, 97, 159. Compare the **raw premultiplied** RGBA data to the corresponding full reference for every channel in ROI, not to Canvas2D or a screenshot.

Six scene subsets: integer-aligned static bars, blob A with inset, blob B with overlapping fill, blob A's single outline, blob B's single outline, all three original groups together. Render each in `OptimizeSpeed` (u8/u16 fine compositing) and `OptimizeQuality` (f32 fine compositing). The path geometry, strip-generation stage and render origins are unchanged across precision modes.

The pass gate requires all origin comparisons to stay within the previously established **1-byte/channel** deviation ceiling; it does **not** require bit-exact equality.

## Observed origin-dependent discrepancies

Mismatches below are **four-frame totals within the fixed ROI**, counting channels, not pixels. Each number repeated identically in both browser contexts and both compositing modes.

| Scene | Original alpha mismatches | Original RGB mismatches | Alpha mismatches, plus one / plus eight / minus four / minus sixteen |
|---|---:|---:|---|
| Integer bars only | 0 | 0 | 0 / 0 / 0 / 0 |
| Single blob A outline | 5 | 10 | 5 / 4 / 5 / 5 |
| Single blob B outline | 14 | 42 | 15 / 14 / 13 / 11 |
| Blob A and inset | 5 | 12 | 5 / 4 / 5 / 5 |
| Blob B and overlap | 14 | 54 | 15 / 14 / 13 / 11 |
| Complete scene | **19** | **66** | 20 / 18 / 18 / 16 |

Maximum channel deviation in every scene and render mode is **1**. In the original origin, both single-path scenes already have alpha deviations. The integer-aligned rectangle control has none. Therefore neither painted shape overlap nor final straight-alpha conversion is a necessary condition for the discrepancy.

Both `OptimizeSpeed` and `OptimizeQuality` produced **identical discrepancy counts** for the tested scenes and origins. This rules against the *difference between these compositing modes* as the cause for this workload. It does not by itself distinguish flattening from tile coverage/strip alpha quantization.

## Source-level mechanism to investigate

In the exact pinned Vello source:

- `vello_common/src/flatten.rs` (lines 40–46) converts kurbo `f64` coordinates to `f32`. The Bézier flattener at `vello_common/src/flatten_simd.rs` also casts cubic coordinates to `f32`.
- `vello_common/src/strip.rs` (lines 449–500) obtains fractional winding/coverage in `f32`, computes coverage ×255 +0.5, clamps it, and converts it to an integer alpha byte.
- `vello_common/src/strip.rs` (lines 584–720) calculates trapezoidal pixel area contributions with `f32` operations.

Rebasing an exact scene-coordinate `480.45` by integer tile origin 448 yields different `f32` representations depending on the order: `f32(480.45 - 448) = 32.45000076293945` versus `f32(480.45) - 448 = 32.45001220703125`. The difference is about **1.14×10⁻⁵** pixel, which could affect a coverage value close to the 8-bit rounding boundary. This is a **mechanistic hypothesis, not direct proof** that any one conversion accounts for the measured mismatched pixels.

## CPU-side timing (not GPU)

Across both repeated runs and all six scenes, median synchronous WASM call durations (20 timed calls after five warmups per case; pooled across scenes):

| Pipeline | Full 800×500 | Original 336×256 tile |
|---|---:|---:|
| Speed / u8-u16 compositing | 2.2 ms | 0.6 ms |
| Quality / f32 compositing | 5.7 ms | 1.3 ms |

These are benchmark-specific **CPU-call timings** with no hardware-GPU, Filament, Canvas2D upload or browser-compositor work measured.

## Decision / next isolated test

The likely source is at or before fractional path coverage generation. The next experiment should **record the flattened line-segment coordinates and/or pre-u8 strip alpha values** from the pinned Vello pipeline at mismatch pixels, with and without integer tile-origin rebasing. A deliberately altered rounding strategy should be tested **as an isolated variant** against the unchanged baseline. Do not modify the production engine or claim strict equality until the intermediate evidence identifies the precise source.

No GPU sharing, automatic damage tracking, native desktop behavior, other render backends or final engine adoption is established. **No merge into main.**
