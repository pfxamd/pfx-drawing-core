# Deterministic randomized Gaussian halo falsification and synchronous CPU WASM timing

## Verified result — 2026-10-12

- [Source-built variable-radius Vello CPU WASM and browser CI](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38286104070): source-build **success**, browser diagnostic suite **success**.
- [Machine-readable pixel evidence and timing samples](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38286104070/artifacts/11763611234).
- [Exact source-build artifact](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38286104070/artifacts/11763337122).
- Branch: `experiment/browser-aa-random-blur-bench` (not merged to `main`); pinned upstream Vello revision `235739c4f08eb48d900e1512459d453a9ab77f96`.
- **CRITICAL:** CI success means the *diagnostic test ran and measured genuine differences*, **NOT that a fixed 16px or 96px halo was byte-correct everywhere**. This run falsifies that universal assumption.

## What changed

- Added experimental WASM export `render_complex_boundary_radius`, maintaining the previous exact source-built stroke, group mask and filter pipeline while accepting independently validated blur radius `0..24`. Vello CPU filter API expects `f32`; Rust validates finite `f64` input and converts only at that API boundary.
- Added local browser binding `PFX_AA.boundaryRadius`.
- Added `compatibility/browser/test-aa-random-blur-bench.cjs`, a deterministic seed-based affine/miter/near-singular property probe, full-oracle ROI byte comparisons, and interleaved WASM timing for selected provably exact ROIs.
- Added independent full pinned-source build + headless Chromium workflow `.github/workflows/browser-aa-random-blur-bench.yml`; the pinned source patch and old export are unchanged.

## Test matrix and falsification results

- Fixed seed: `0x70de2026` XOR canvas width and height, xorshift32; deterministic cases and reverse-order replay.
- Canvases: **640×400**, **800×500**, **1024×640**.
- Two independent browser contexts: **216** rendered scene instances, **432** independently selected ROI reference comparisons (72 per context/canvas).
- Actual blur radii: `0`, `2`, `5.25`, `8`, `12`, `20`.
- Both Gaussian and Gaussian + an isolated global-coordinate alpha mask. Anisotropic, rotated, fractional-translated and near-singular affine transforms; varying sharp miter stroke widths.
- Source rectangles **always** expanded by requested halo and snapped to the full-frame 4px strip phase. Source tile is independently rasterized by real Vello CPU WASM and every contained ROI RGBA channel compared to full reference with **no 1/255 tolerance**.
- All tested source rectangles remain strictly smaller than the whole canvas. The whole-scene reference is used **only as a post-hoc pixel oracle**, never as an ROI pixel source.

| Blur radius | 0px halo: failing ROIs | 16px halo: failing ROIs | 96px halo: failing ROIs |
| --- | ---: | ---: | ---: |
| 0 | 0 | **0** | **0** |
| 2 | 4 | **2** | **2** |
| 5.25 | 12 | **8** | **8** |
| 8 | 30 | **24** | **22** |
| 12 | 54 | **44** | **30** |
| 20 | 54 | **52** | **40** |
| **All 432 ROIs** | **154** | **130** | **102** |

Other measured halo values: 32px failed in 130 ROIs; 64px failed in 106. No proposed halo 0/16/32/64/96 worked for all sampled radii/affine/mask/origin combinations. The radius-0 group contained 72 ROI checks across the six context/canvas runs and had no byte mismatches.

**Important failure characteristic:** some radius-5.25 and radius-8 cases preserved thousands of changed channels even with a 96px globally phase-aligned halo. In these samples, changed-channel maxima were 2–3 byte values (not only 1). Other cases differed nonmonotonically with halo size. Therefore the data **cannot** be explained by mere insufficient filter radius padding; the exact internal source-layer/filter coordinate and numerical dependence must be traced. The previous successful 16px suite covered its tested scenes only, and remains valid within that narrower envelope.

## Timed exact ROI samples, not a general speedup

An interleaved headless Chromium microbenchmark used the **same exact variable-radius WASM entrypoint** for both full-frame (800×500, 400,000 pixels) and globally phase-aligned / 32px-padded ROI source (34,496 pixels), 4 warmups and **18 timed calls per configuration**. These six selected ROI probes were **strict RGBA-exact** to their corresponding full references at 32px. Median synchronous CPU/WASM-plus-byte-return milliseconds in the first browser context:

| Gaussian radius | Mask | Full frame median | Verified ROI source median |
| --- | --- | ---: | ---: |
| 0 | No | 3.6 ms | **0.7 ms** |
| 2 | No | 5.2 ms | **1.0 ms** |
| 5.25 | Yes | 4.9 ms | **0.9 ms** |
| 8 | Yes | 8.2 ms | **2.1 ms** |
| 12 | No | 3.6 ms | **1.2 ms** |
| 20 | No | 5.4 ms | **2.6 ms** |

Timing values vary with GitHub runner load and individual scene content, and they do not include actual editor invalidation, compositing on-screen, GPU texture upload, or native multi-thread CPU graphics. **They apply only to these exact probes.** Other ROIs at the *same* radius failed pixel equality and thus must not use this partial route without further correction or an explicit full-frame correctness fallback.


## Explicit fail-closed fallback reverified after falsification

A separate [hash-guarded browser replay](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38286942733) used the **identical source-built WASM** from run 38286104070 (exact source/Cargo/trace/patch/browser Git blob hashes checked) after adding an independent `safe=true` verification step.

- Each of the **130** ROI comparisons that failed with a 16px phase-aligned halo was re-rendered by the WASM export's **actual full-frame fallback + crop**.
- Against independently rendered full-reference pixels: **0 mismatched channels in all 130 fallback crops**.
- The 432-ROI diagnostic matrix retains all **130 known native partial failures**; nothing is hidden by tolerance changes or by marking an unsafe ROI as passing.
- [Machine-readable fallback evidence](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38286942733/artifacts/11764086232).

This confirms the fallback implementation for the tested cases; it does **not** mean that arbitrary variable-radius blur is now efficiently dirty-rasterized. The browser job's `PASS` signifies diagnostics/fallback verification, not universal native ROI equality.

**Performance reproducibility caveat:** repeated GitHub Actions runs varied substantially even for the same byte-exact configurations. In the guarded replay, full-frame medians ranged from **2.1 to 4.5 ms**, with the 34,496-pixel source medians **0.4 to 1.5 ms**, across the same six selected 800×500 cases. Comparisons must remain within one run and exact ROI; neither run provides production frame-time guarantees.

## Conclusions / safe next step

1. **Fail closed** for arbitrary blur radii, masks, transforms or source origins not covered by a rigorously verified contract; the empirically fixed 16px halo must **not** be promoted to a universal policy.
2. Preserve global pre-quantization flattening and 4px strip-phase alignment (both independently supported by earlier tests); investigate Vello CPU **filter-layer source-coordinate origin, intermediate mask sampling, and filter raster buffer extents** in the mismatched ROI pixels.
3. Design a radius-specific, transform-aware source-expansion proof only after resolving differences that persist with large halos. Add deterministic cases from this suite as regression fixtures.
4. Performance work must measure **corrected / proven exact** partial rendering independently from hardware GPU timing and real editor end-to-end redraw. Do not merge to `main` on these results.

The suite's **PASS** asserts that the browser ran the diagnostic, full-canvas canonical modes agreed, and tested ROIs exercised actual non-white content. It does **not** assert zero tile mismatches. All failing ROI evidence is preserved in JSON for follow-up.
