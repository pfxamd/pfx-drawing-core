# Dynamic Bézier path hulls and hierarchical group damage

## Verified — 2026-10-12

- **Browser test:** [GitHub Actions run 38270743650](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38270743650), source-build job **success** and browser job **success**.
- **Source proof:** [pinned Vello CPU WASM build artifact](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38270743650/artifacts/11757046302), exact upstream source SHA `235739c4f08eb48d900e1512459d453a9ab77f96`, assertive temporary source patch and build logs.
- **Browser evidence:** [6 complete JSON results, summary, real Chromium screenshot](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38270743650/artifacts/11757166772). All 6 isolated browser context/canvas-size runs **PASS**.
- **Numerical results:** 78 frame transitions tested; 360 independently source-rendered dirty-rectangle calls; **361,272 genuinely changed full-reference pixels**, **0 missed changed pixels**, **0 mismatched canonical tile RGBA channels**, **0 mismatched channels after applying tiles to persistent caches**. The original local-first Vello path still produces **204 mismatched channels** under the same conditions.
- **No changes to `main`**, no production engine adoption, and no native/GPU/Filament speed or compositing claims.

## Generalized path bounds

The previous `operation-damage.cjs` estimator used manually predeclared per-kind shape rectangles. The new experimental module `path-group-damage.cjs` accepts declarative, arbitrary **Move, Line, Quadratic, Cubic, Close** path command lists, under numeric safety limits. Each drawable node carries a stable integer ID, local translation, opacity, paint choice and optional stroke width.

`controlBounds` computes a **conservative axis-aligned hull** from all Bézier control points and applies its inherited group and own translations. Stroke width is padded by half the maximum stroke thickness, with an additional 8-pixel margin for antialiasing and finite-precision uncertainty. Bounds are clipped to the actual canvas and merged conservatively when they touch/overlap. **These are safe overestimates for the selected translation-only, finite path grammar, not tight analytic Bézier extrema or a fully general transformed stroke bound.**

The bounding-box calculation reads no rendered pixels, screenshots or references; it operates on the same arbitrary path commands provided to the Rust renderer. Invalid IDs, malformed paths, out-of-range parameters, duplicate nodes, excessive nesting and other unsupported commands are rejected.

## Hierarchical group dependencies

Each group has a stable ID, translation, opacity, blend mode, optional rectangle clip and ordered children. The JS estimator traverses actual nested scene state and stores a *per-leaf signature* including all ancestor IDs, translations, opacity, blend and clip state, the leaf's geometry and style, and its effective paint order.

Changes to a group's translation, opacity, blend or clipping therefore automatically invalidate **all its descendants' old and/or new hulls**; they are not limited to the group's own rectangle. Insertion, removal and reordering of groups conservatively invalidate affected leaf sets. Control-point edits, changes of stroke width and object moves invalidate both old and new geometry bounds. Unchanged graph state returns no damage rectangles.

This proof deliberately does **not** attempt clip-based damage tightening; it uses the un-clipped control-point hull of each descendant. Offscreen geometry is clamped to the relevant canvas. The group invalidation policy is conservative to avoid missing raster changes; additional unchanged pixels may be rerendered.

## Scene and strict browser verification

A second independent WASM entrypoint `render_complex_graph` parses the **same serialized path/group command stream** used by the JS estimator. The Rust code creates actual Vello CPU filled/stroked Bézier paths, nested group opacity and blend layers and rectangular clip paths, then renders them independently in either full-frame or dirty-rectangle viewports. Its original and canonical source-level flatten modes remain selectable. The new graph and estimator live only in this experiment.

- Canvas sizes: **640×400**, **800×500**, **1024×640**.
- Two browser contexts, reverse canvas iteration on second pass.
- 14 graph states (initial + 13 transitions), covering group move, opacity change, blend change, group reorder, child delete and reinsert, arbitrary cubic control-point edit, stroke-width change, group clip change, child reorder plus opacity, insertion of a new group, complete group deletion, and a no-op state.
- Two dirty replay layouts: whole semantic damage rectangles and **four deliberately overlapping sub-tiles per rectangle**. Raster tiles are rendered from the full current graph, and bytes are pasted into an actual buffer seeded from the initial full frame and **never reset from later reference frames**.
- The independent full references are created only for post-hoc verification: all changed pixels must lie inside the previously selected operation-derived damage rectangles; all four premultiplied RGBA channels in all source-rendered tiles must equal their corresponding full reference; and the entire persistent cache after each transition must be byte-exact.
- Input validation and explicit descendant-group invalidation checks are run before browser tests. At least one genuinely partial region and a zero-damage no-op are required.
- Full-reference canonical versus legacy raster outputs are also checked: 0 differences at the full frame.

### Measured proof

| Metric | Value |
| --- | ---: |
| Browser contexts × canvas sizes | 6 |
| Transition checks | 78 |
| Independently rendered dirty tiles | 360 |
| Actually changed full-frame pixels | 361,272 |
| Changed pixels missed by estimated damage | **0** |
| Canonical tile-channel differences | **0** |
| Persistent-cache channel differences | **0** |
| Original local-first channel differences | 204 |

The operation-derived damage-area fraction per transition (including no-op) in the first context:

| Canvas | Smallest nonzero estimated area | Largest estimated area | No-op |
| --- | ---: | ---: | ---: |
| 640×400 | 15.4% | 59.2% | 0% |
| 800×500 | 9.9% | 44.0% | 0% |
| 1024×640 | 6.0% | 26.8% | 0% |

These are **estimated damage areas**, not measured speedups, GPU uploads, or actual time spent rasterizing. The partial repaint workload is deterministic and includes selected combinations of source-layer and geometric changes.

## Implementation references

- `compatibility/browser/path-group-damage.cjs`: declarative nested scene model, source-path control hull bounds, inherited group invalidation, serialization and 14-state test fixture.
- `compatibility/browser/vello-complex/src/lib.rs`: new `render_complex_graph` byte-producing WASM export.
- `compatibility/browser/web/aa-precision.html`: browser harness export binding.
- `compatibility/browser/test-aa-path-group-damage.cjs`: actual Chromium validation, independent full reference, two persistent caches, conservative damage-oracle check, raster byte comparisons and screenshot.
- `.github/workflows/browser-aa-path-group-damage.yml`: builds the pinned Vello CPU source from scratch, applies a temporary patch and stores build and browser proof.

## Limitations and next gates

This is a **numerical prototype**, not a general-purpose damage detector yet. It currently handles translated groups, the fixed supported paint and blend modes, rectangular group clips, finite quadratic/cubic/line paths, source-over layers, and conservative stroke-width expansion. Rotated/scaled/skewed transforms, nonstandard joins/miter limits, filters and shadows, mask expansion, deep effect dependencies, arbitrary textual glyph geometry, image paints, layer caching across dependency changes and unknown drawing operations need additional treatment.

The reference images are post-hoc validation only; the estimator uses operations, not pixel diffs. Browser CI runs the CPU WASM in headless Chromium with a software backend; it does not provide native desktop or physical GPU evidence. **The independent base branch and `main` remain unchanged.**
