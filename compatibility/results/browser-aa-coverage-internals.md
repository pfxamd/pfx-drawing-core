# Antialias coverage pipeline: prequantized value and flattened geometry trace

## Verified result — 2026-10-12

- [Successful run 38250617769](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38250617769): 2 isolated single-path workloads × 2 fresh browser contexts = **4/4 passed**.
- [Machine-readable browser evidence](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38250617769/artifacts/11747684179): four individual cases and one aggregate summary.
- [Source-built WASM and pinned-source patch](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38250617769/artifacts/11746883813).
- Upstream source is the pinned Vello revision `235739c4f08eb48d900e1512459d453a9ab77f96`. The experimental patch applies only to a temporary GitHub Actions source checkout; it does not replace production source.
- The browser uses actual Vello CPU WASM. No Filament, shared GPU context, native renderer or hardware GPU timing is involved.

## How the measurement isolates the stages

The experiment captures **actual intermediate Vello data**, rather than estimates obtained by inverse alpha conversion:

1. `vello_common/src/strip_generator.rs`: the flattened `f32` line segments immediately after `flatten::fill`.
2. `vello_common/src/strip.rs`: the SIMD `f32` mask values immediately before `f32_to_u8`. These are `clamp(255 * coverage + 0.5)` values (not normalized coverage), captured bit-for-bit in f32 representation.
3. The same location's quantized `u8` mask, then the rendered premultiplied RGBA output.
4. Compare full 800×500 rendering with three tile origins at (448,96), (449,97), (432,80); all contain the same ROI (464,112)–(776,344). Four sampling frames: 0, 43, 97, 159.

The single Bézier paths are filled using fully opaque paints and contain no overlapping shapes, allowing output alpha to be compared directly with their coverage masks. Two independent Chromium contexts repeat each scene. The trace is bounded and the test fails if it truncates, if intermediate coverage is absent, or if the previous 1/255 alpha-delta bound is exceeded.

## Actual observations

Values in this table are aggregated **per single complete four-frame × three-origin browser run**; the second browser context reproduces them identically. Do not double-count the repetitions.

| Single shape | Changed pixel alpha | Different pre-u8 f32 coverage at those pixels | Different quantized mask bytes | Largest pre-u8 difference | Largest original-global line-coordinate delta |
|---|---:|---:|---:|---:|---:|
| Bézier blob A | 15 | 15 | 15 | 0.0205193 (255-scale) | 0.0008621 px |
| Bézier blob B | 40 | 40 | 40 | 0.0459595 (255-scale) | 0.0008698 px |
| **Total** | **55** | **55** | **55** | ≤0.0459595 | ≤0.0008698 px |

All 55 observed changed alpha values agree with their recorded quantized masks on both the full render and tile render; no trace entries were missing at mismatch locations. The maximum *final* channel alpha difference is 1/255.

For example, in blob A at global pixel (570,142), frame 43, region origin (448,96):
- Full pre-u8 mask = **180.99551391601562**, quantized alpha = 180.
- Tile pre-u8 mask = **181.01126098632812**, quantized alpha = 181.

In blob B at (686,196), frame 0, the corresponding pre-u8 mask values are **20.992961883544922** and **21.005630493164062**, producing 20 and 21. These are *actual traced upstream values*, not approximate reconstructions.

Restoring each tile's origin to flattened line endpoints still produces nonidentical float coordinates (up to ~0.00087 px for the tested comparisons). The output error therefore exists **before** the integer alpha conversion, and the stage-by-stage trace shows how it crosses the quantization threshold.

## Interpretation and unresolved attribution

This establishes the **observed causal chain** for the tested samples: scene origin changes → different intermediate flattened line coordinates and f32 strip coverage → different quantized alpha mask → differing visible pixel alpha. Both flattening and prequantized mask values are directly recorded, so these are no longer inferences from final output alone.

It has **not** isolated which arithmetic operation contributes which proportion of the float difference. In particular, path flattening/culling, tile-coordinate subtraction, and trapezoid area accumulation may all contribute; segment-index comparisons are not stable identifiers under arbitrary culling. This test is not a demonstration of bit-exact dirty rendering or a universal numeric fix.

## Next experiment

Compare a prototype that performs geometry flattening in a **consistent global coordinate space**, then applies tile-local offset later in the pipeline, against the unchanged pinned reference. Separately test alternate rounding under the same fixed geometry and quantify exact-pixel parity, runtime cost and regressions. Keep the changes isolated; no final engine adoption.

## Reproduction

- `compatibility/browser/aa-coverage-internals/pfx_trace.rs`
- `compatibility/browser/aa-coverage-internals/patch-upstream.cjs`
- `compatibility/browser/test-aa-coverage-internals.cjs`
- `.github/workflows/browser-aa-coverage-internals.yml`

All patches are explicit and fail if upstream source anchors differ. No changes to `main`.
