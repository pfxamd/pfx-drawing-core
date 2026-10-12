# Operation-derived dirty regions: layered scene lifecycle with exact retained-frame replay

## Verified outcome — 2026-10-12

- [Source-built pinned Vello CPU WASM from CI run 38266908819](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38266908819): Rust compile and WASM export job **successful**. Vello upstream pinned to `235739c4f08eb48d900e1512459d453a9ab77f96`, temporary source patch as in previous numerical experiments.
- [Corrected and verified Chromium browser run 38267410836](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38267410836): **6/6 canvas/browser-context suites PASS**, **48/48 frame transitions**, **360 real tile raster calls**, **zero missed changed pixels**, **zero canonical/retained-frame RGBA channel differences**.
- [Detailed JSON and real browser screenshot](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38267410836/artifacts/11754828835).
- Original local-origin control: **120 differing RGBA channels** in the independently rendered changed-region samples, canonical global-flattened path: **0**.
- The first browser workflow in run 38266908819 did not pass due to a JavaScript semantic-reporting guard: a single operation changing blend **and** clip was initially logged under only the first property. The corrected estimator reports **all** changed properties and the source-guarded replay of the exact built WASM passes. This was a test/control issue, not a compiled render failure.

## New experiment structure

The pinned-source Vello CPU diagnostic exports `render_complex_operations(full_width, full_height, ox, oy, width, height, commands, canonical)`.

- `commands` is an ordered sequence of **7 f64 fields per operation**: `[stable_id, shape_kind, translation_x, translation_y, opacity, blend_mode, clip_flag]`.
- Shape kinds cover two fractional cubic/quadratic filled paths and a thick curved stroke.
- Paint, clip and blend layers are rendered by the **real Vello CPU path**, not by CSS or an image fixture.
- Supported blend variants in this proof are Normal, Multiply, Screen and Overlay, composited as source-over with independent group opacity.
- The exact same command arrays drive full-frame reference renders, baseline local-first tile renders, and corrected global-flatten tile renders. Only raster extent, origin and the canonical flag differ.
- Rejects invalid canvas rectangles, malformed commands, invalid parameters and unsupported operation types.

The independent `compatibility/browser/operation-damage.cjs` module computes dirtiness **only from the old/new commands**, with shape-envelope metadata, transforms and layer indexes. It **never reads frame pixels or receives full rendered images**.

Damage estimation:

1. Match drawing operations by stable ID and compare shape kind, translation, opacity, blend, clip and index in layer stack.
2. Classify **all simultaneous changes**: insert, delete, replace, move, opacity, blend, clip and reorder.
3. Conservatively include both the old and new bounds for each changed object, allowing deletion and relocation to erase old pixels.
4. Expand known analytic shape envelopes with a 5-pixel antialias margin, clamp to the canvas, and merge intersecting/touching rectangles.
5. Emit **zero** dirty rectangles for an identical command stream. Independent, spatially separated changes may produce multiple rectangles.

**Important limit:** manually defined conservative shape envelopes are paired with these known three shape kinds. This does **not** prove generic automatic damage propagation through arbitrary nested layer/clip graphs or third-party renderer commands.

## Strict end-to-end retained-frame verification

Canvases: **640×400**, **800×500**, **1024×640**. Two independent browser contexts, with reversed canvas/layout order on the second context.

Each canvas has **9 declared scene states** and **8 state transitions** covering:

- move an existing path with fractional offsets,
- delete a path and later reinsert it,
- reorder painted objects,
- change opacity and blend modes,
- switch path clipping,
- update two spatially separated elements,
- perform one **no-op transition** (identical scene, no invalidation).

For each transition, the test:

1. Calls the estimator with **old/new command streams only** to choose damage rectangles.
2. Starts with a true initial full-frame raster once per independent repaint strategy, then **keeps the same persistent byte-addressable RGBA buffer for the entire scene sequence**.
3. Executes either full rectangles or a 4-way overlapping rectangle split, via independent source-built CPU WASM calls, and copies the returned RGBA bytes into that persistent buffer at the exact absolute pixel offsets.
4. Validates every pixel of the entire resulting buffer against a separately rasterized full-frame reference image. This reference is never passed to the estimator.
5. As a separate audit **after rectangle selection**, compares old/new full-reference pixels to ensure **no actually changed pixel was left outside** the command-estimated dirty rectangles.
6. Also checks that a full-frame render with canonical geometry equals the unchanged original full-frame path byte for byte, and compares control local tile outputs against the reference.

**Verified aggregate across six complete browser/canvas suites:**

| Metric | Result |
| --- | ---: |
| Tested state transitions | **48** |
| Actual independent tile render calls, including overlapping splits | **360** |
| Pixel locations changed in independent full-frame truth comparisons (repeated across contexts) | **429,710** |
| Changed pixels absent from operation-derived damage | **0** |
| Corrected canonical tile RGBA channel mismatches | **0** |
| Persistent full-frame cache RGBA channel mismatches after repaint | **0** |
| Original local-first RGBA channel mismatches in tested dirty areas | **120** |
| No-op invalidations | **0** |

The two methods for rerendering a rectangle are: (a) draw each dirty rectangle as one tile, and (b) split every rectangle into **four intentionally overlapping tiles**. The latter exercises repeated writes, order independence of equivalent full-scene subregion renders, and dirty-region boundary handling. The final retained full scene always agrees byte for byte with the independently rendered reference.

The conservative command-derived repaint regions used the following fractions of canvas area across nontrivial scene transitions, per browser context:

| Canvas | Per-transition dirty-area fraction range |
| --- | ---: |
| 640×400 | **14.2%–37.0%** |
| 800×500 | **10.8%–36.7%** |
| 1024×640 | **6.6%–22.4%** |

The one no-op transition yields **0%**. Area is derived from operation geometry, not from image pixels; repeated overlapping 4-tile rasterization can process more total pixels than the merged damage area. These are size/geometry-specific results, **not measured speedups or saved GPU bandwidth**.

## Reproduction

- Scene-command renderer export: `compatibility/browser/vello-complex/src/lib.rs`
- Pure semantic estimator, descriptor encoding and fixed lifecycle suite: `compatibility/browser/operation-damage.cjs`
- Real browser and retained-cache comparator: `compatibility/browser/test-aa-operation-damage.cjs`
- Browser WASM export loader: `compatibility/browser/web/aa-precision.html`
- Pinned Vello source build and strict source-hash-guarded replay: `.github/workflows/browser-aa-operation-damage.yml`
- Diagnostic source patch: `compatibility/browser/aa-coverage-internals/patch-upstream.cjs` and trace metadata.

## Verification boundaries and decision

- The estimator handles three known source operation types; there is no general scene graph, arbitrary filter/mask support, image paints, text/glyphs, recursive clip dependency tracking, changing gradient transforms or native GPU cache invalidation.
- The comparator uses headless Chromium running pinned Vello **CPU WASM**. The actual operation-specific scene shows correctness only for the enumerated geometry and animation states.
- Reference full frames are used only for independent truth validation; the **damage planner never receives them**. A production engine would require conservative geometry output from its complete scene system, including paint extents, clipping, effects, deletions and grouping.
- This test did **not benchmark render times** for the operation-derived plans, and makes no speedup claim. Frame scheduling, memory transfers, hardware GPU and 2D/3D shared-surface compositing remain unverified.

**Decision:** retain this as a verified experimental foundation for moving from full-image oracle damage to command/scene semantic damage. Extend to unknown path bounds, group-level effects and adversarial invalidation sequences before considering production integration. Keep `main` untouched.
