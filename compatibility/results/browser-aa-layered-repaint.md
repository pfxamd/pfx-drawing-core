# Source-built Vello CPU: layered opacity, blend modes and sequential dirty tile repaint

## Verified outcome — 2026-10-12

- [Successful corrected browser workflow 38264971384](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38264971384): **30/30 case contexts passed** (5 layer/blend modes × 3 canvas sizes × 2 fresh Chromium contexts).
- [8-file JSON + screenshot artifact 11754810445](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38264971384/artifacts/11754810445): 6 detailed context/canvas JSONs, aggregate summary and actual browser screenshot.
- [Pinned Vello source build job from 38264169743](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38264169743): the compiler and WASM-bindgen/export steps passed. The first browser run failed an inappropriate test-only assertion requiring fractional **final alpha** over an intentionally **opaque backdrop**. Its exact source-built binary was subsequently replayed, guarded by matching Rust/Cargo/source-patch/HTML blob hashes. The corrected assertion tests fractional **RGB mixing** and the final browser run succeeds.
- The test suite finds **1,032 differing RGBA channels** in the original local-origin path across 2 browser contexts, compared with **zero** for the canonical globally flattened path. Every tested sequential repaint resolves to exact full-frame output, with **zero** changed channels.
- No merge into `main`, no adoption of a production drawing engine and no GPU/Filament hardware evidence.

## Real source-rendered layered scene

The new diagnostic entrypoint `render_complex_layered` draws using pinned-source Vello CPU WASM, including actual GPU-independent layer and blend functions, not CSS/browser Canvas blending:

1. A fixed white and magenta opaque backdrop for discernible overlay colors.
2. A moving cubic/quad filled path inside a **0.71-opacity parent group**.
3. A nested **blend-mode** group and **0.59-opacity subgroup**, containing a second moving Bézier filled path and a curved white stroke.
4. One optional irregular path clip inside those nested groups.
5. A separate final foreground stroked curve outside the isolated groups.

The five scene cases are **Normal**, **Multiply**, **Screen**, **Overlay**, and **clipped Multiply**, all with the same parent/child opacity values. The resulting color mixtures are genuinely exercised: comparing each of the four non-normal first frames against the normal first frame yields an **aggregate of 245–281 changed RGBA channels per canvas**; this is a combined count across modes, not a minimum for each individual blend mode. Intermediate RGB values are present in the opaque backdrop. **Final alpha over the intentionally opaque backdrop is expected to remain 255**, so opacity is validated through blended RGB, not through a false fractional-output-alpha assertion.

Both original local-origin flattening and globally canonical flattening use identical layer content, masks, paint colors, clip shapes, full-canvas dimensions and render context state. Only the selected source-level geometry-origin handling differs.

## Per-tile pixel proof

Three canvases: **640×400**, **800×500**, **1024×640**.

For each scene mode and canvas, compare four frames **0, 27, 63, 111** against a separately rendered full reference. Three independent dirty rectangles, at different fractional positions relative to canvas dimensions, are each tested across **every contained pixel in all four premultiplied RGBA channels**.

- Full-canvas canonical rendering is independently verified byte-identical with full-canvas original rendering.
- Each dirty rectangle is rendered twice, once with original local-first flattening and once with global canonical flattening.
- The comparison fails for any **nonzero** channel delta; the old 1/255 allowance is **not** applied.

| Canvas | Modes per context | Original mismatched RGBA channels per context | Canonical mismatched RGBA channels |
|---|---:|---:|---:|
| 640×400 | 5 | 146 | **0** |
| 800×500 | 5 | 230 | **0** |
| 1024×640 | 5 | 140 | **0** |
| All sizes / context | 15 | 516 | **0** |
| Both contexts | **30** | **1,032** | **0** |

The reference images and tile outputs originate from the same actual pinned Vello CPU implementation; the test does not substitute the full-frame answer for a dirty-region render.

## Sequential repaint: real cached-buffer updates

Each mode and canvas maintains an independent byte-addressable cached RGBA frame:

1. Seed the cache with the real rendered full reference at **frame 0** only.
2. For each transition **0→27, 27→63, 63→111**, compute a conservative damage rectangle by examining the exact differences between the two independently rendered full references. Pad that rectangle by 9 pixels; clamp to the canvas.
3. Split the rectangle into **two overlapping vertical tiles** and separately into **four overlapping grid tiles**, testing two complete independent replay strategies for each transition.
4. Rerender **each** selected tile from the actual updated Vello WASM scene in canonical mode and **copy those RGBA bytes** into the existing cached frame at the correct absolute pixel offset.
5. Compare **every pixel and every channel of the entire cached canvas** against the independently rendered full new frame after all tiles have been applied.

Totals across both browser contexts: **180 frame-transition replays**, **540 independently rasterized tile updates**, **0 differing channels** after each complete repaint.

The conservative oracle-derived damage rectangles cover approximately **3.31%–8.47%** of full-frame area per transition, depending on canvas size. With the deliberate overlap, actual total rerendered tile areas are approximately **3.75%–9.59%** of equivalent full-frame area. These area figures do not establish physical memory bandwidth or GPU transfer costs.

**Important limitation:** the damage rectangle is computed from full-reference pixel differences. This proof verifies **repaint compositing, not a production damage-detection/invalidation algorithm**. It does not establish frame scheduling, editor/UI responsiveness, interoperation with live WebGL or partial GPU texture uploads.

## Synchronous browser CPU WASM timings

20 measured calls per rendering mode following 4 warmups, interleaved order, on headless Chromium in GitHub Actions. Example mode is clipped Multiply. Values are approximate medians:

| Canvas | Full frame | Original local dirty tile | Canonical dirty tile |
|---|---:|---:|---:|
| 640×400 | 2.3–2.4 ms | 0.8 ms | **0.8 ms** |
| 800×500 | 3.2 ms | 1.5 ms | **1.5 ms** |
| 1024×640 | 4.4 ms | 2.0 ms | **1.9–2.0 ms** |

These timings capture synchronous WASM processing and output allocation, not browser painting, thread contention, native backends, physical GPU acceleration, actual 2D/3D composition or upload time. No broad performance guarantee is inferred.

## Reproduction

- Experimental source export: `compatibility/browser/vello-complex/src/lib.rs`
- Browser loader: `compatibility/browser/web/aa-precision.html`
- Strict pixel and incremental cache test: `compatibility/browser/test-aa-layered-repaint.cjs`
- Source-built/guarded replay CI: `.github/workflows/browser-aa-layered-repaint.yml`
- Temporary pinned upstream Vello source patch: `compatibility/browser/aa-coverage-internals/patch-upstream.cjs`, `compatibility/browser/aa-coverage-internals/pfx_trace.rs`.

No changes to upstream Vello or PFx `main`.

## Next verification boundary

Test a **scene-operation-derived conservative damage estimator** instead of the pixel-diff oracle, plus layered object lifecycle (move, delete, reorder) and changing opacity/blend modes across consecutive frames. Then investigate dirty repaint underneath genuine 2D/3D browser compositing, and any texture-upload savings using real GPU measurements. Keep numerical equality and end-to-end latency as independent gates. Do not promote the proof to production before those checks.
