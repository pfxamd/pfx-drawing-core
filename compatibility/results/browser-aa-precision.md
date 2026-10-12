# Browser AA precision and transformed dirty regions

## Verified results — 2026-10-12

- [Verified browser CI](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38245323233): successful.
- [Detailed evidence run](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38245302308): 18/18 scenarios passed (6 transforms × 3 isolated browser contexts).
- [25-file evidence artifact](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38245302308/artifacts/11744971002): 18 JSONs, 6 browser screenshots and summary.
- The pinned-source Vello CPU WASM instrumented binary was rebuilt successfully in [run 38244834052](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38244834052), Vello upstream SHA `235739c4f08eb48d900e1512459d453a9ab77f96`. Later runs replayed that exact build without Rust changes.

## Method

For frames 0, 43, 97 and 159 compare an independently rendered full 800×500 image against the original core dirty rectangle (448,96,336,256), redrawn with padding 0/8/16/32 (clamped to canvas limits). Check every RGBA byte of the original core, both directly from premultiplied Vello Pixmap pixels and after straight-alpha conversion. Test identity, fractional translation, zoom 0.85, zoom 1.08, rotation 0.09 rad and a combined transform. Check motion, AA, module loading and output sizes. Preserve the previous Vello full-render entrypoint and verify its identity output is bit-for-bit unchanged.

**Pass means numerical discrepancies do not exceed 1/255. It does not mean pixel equality.**

## Mismatched RGBA channel counts

Four reference frames per transform. All three repeats produced identical counts. Values correspond to padding 0 / 8 / 16 / 32 pixels.

| Transform | Straight RGBA | Raw premultiplied RGBA |
| --- | --- | --- |
| Identity | 33 / 32 / 31 / 38 | 85 / 81 / 74 / 96 |
| Fractional shift | 29 / 23 / 25 / 31 | 72 / 56 / 58 / 77 |
| Zoom out | 32 / 32 / 33 / 30 | 73 / 72 / 74 / 69 |
| Zoom in | 36 / 38 / 33 / 30 | 99 / 100 / 86 / 75 |
| Rotation | 20 / 19 / 19 / 21 | 68 / 68 / 64 / 67 |
| Combined | 29 / 27 / 29 / 31 | 71 / 67 / 69 / 74 |

All cases had maximum deviation **1 byte level**. No padding gave exact equality, nor did larger padding monotonically improve it. Identity pad 0 had 33 mismatched straight channels: 14 green and 19 alpha, all at least 8px inside the core boundary. Premultiplied data had 85 mismatches, including all 33 straight mismatches. The alpha conversion can *hide* a difference but is not its sole source. The precise internal Vello rasterization step responsible remains undetermined.

## CPU-side WASM render calls

Median of 18 per-scenario medians; 24 timed calls after 3 warmup calls. No Filament, GPU or Canvas2D upload in this benchmark.

| Region | Input bytes per call | Median, ms | Median of p95, ms |
| --- | ---: | ---: | ---: |
| Full 800×500 | 1,600,000 | 2.2 | 2.5 |
| Pad 0 | 344,064 | 0.7 | 0.8 |
| Pad 8 | 382,976 | 0.7 | 0.8 |
| Pad 16 | 423,936 | 0.8 | 0.9 |
| Pad 32 | 491,520 | 0.8 | 0.9 |

No moving output was detected outside the original core between the *sampled* verification frames. This does not prove valid dirty bounds for arbitrary animation and transforms.

## Decision and limitations

Padding is **not** an established fix for the 1/255 subpixel discrepancy. Before modifying raster algorithms, trace Vello CPU AA coverage and quantization with fixed geometry and varying raster origins. The experiment proves bounded numeric equivalence only for these specific cases, not hardware GPU performance, GPU context sharing, exact pixels or production integration.

Source: `compatibility/browser/vello-complex/src/lib.rs`; test: `compatibility/browser/test-aa-precision.cjs`; workflow: `.github/workflows/browser-aa-precision.yml`. The workflow replays the instrumented source-built artifact and must be changed to rebuild when Rust sources change. **No engine adopted; no merge into main.**
