# Source-built affine group transforms and conservative partial-repaint damage

## Verified result — 2026-10-12

- [GitHub Actions run 38273576817](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38273576817): **both source-build and Chromium browser proof jobs passed**.
- [Source-built pinned Vello CPU WASM, temporary upstream patch and compiler logs](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38273576817/artifacts/11757638816).
- [Machine-readable browser proof and actual browser screenshot](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38273576817/artifacts/11758665845).
- **6/6** browser-context/canvas runs passed. **144** separately checked scene transitions, **690** actual source-built WASM dirty-tile calls, **922,232** changed reference pixels. **0** missed changed pixels; **0** canonical RGBA tile-channel mismatches; **0** accumulated cache RGBA mismatches. The original local-coordinate path differed on **356** channels.
- Experiment **isolated from `main`**. No production engine integration or hardware GPU timing claim.

## Changes

The prior experiment could only translate groups; this branch adds true affine composition throughout both its dirty estimator and an **independent** source-built Vello CPU WASM rendering export. The previous translation-only graph implementation and exports remain unchanged.

**JavaScript damage estimator**: `compatibility/browser/affine-group-damage.cjs`

- A node's six-number affine matrix uses Kurbo's `[a,b,c,d,e,f]` convention: `x' = ax + cy + e`, `y' = bx + dy + f`.
- Descendant transforms compose in parent-to-child order, with full double-precision world-transform construction.
- Each quadratic/cubic/linear path's **transformed control-point hull** supplies a conservative axis-aligned rectangle. All control points, not only endpoints, are transformed.
- Expands stroked path bounds by half the stroke width multiplied by the **Frobenius norm of the affine's linear part** (an upper bound for singular-value stretch), plus **12 px** of extra conservative AA/numerical padding.
- Bounds are clamped to the canvas, then unioned/merged. They can intentionally overestimate changed regions; they are not tight extrema of Bézier curves.
- Stable node ID and inherited group signatures track ancestor affine transform, opacity, blend, rectangle clip and drawing order. Changes to any ancestor invalidate all affected descendants' **old and new** transformed path hulls. Deletion, insertion and reordering are covered.
- The damage planner reads only graph commands and properties; full-frame pixels are **not** used to choose dirty rectangles.

**Rust/WASM source-built renderer**: `render_complex_affine_graph` in `compatibility/browser/vello-complex/src/lib.rs`

- The same serialized scene encodes independent affine matrices for each path and nested group.
- The renderer uses a stack of composed global affine transforms, delegates opacity layers and `Normal`/`Multiply`/`Screen`/`Overlay` compositing and rectangle clips to actual pinned Vello CPU code, and rasterizes either the full canvas or an independently localized dirty tile.
- Two modes retain the original local-first Vello f32 flattening path and the canonical global-first experiment, allowing independent per-channel numerical comparison.
- This only changes **experiment-only** source under `compatibility/`; the pinned upstream version is unchanged in its repository.

## Verified test matrix

Canvas sizes: **640×400**, **800×500**, **1024×640**.

Two separate Chromium contexts run each canvas, reversing canvas order on the second context. For each canvas/context, a **25-state** declarative animation (24 transitions) includes:

- Earlier group lifecycle and nested opacity/blend/clip/line/curve/stroke edits.
- Group rotation around a specified center, uniform zoom, **anisotropic** scale, fractional translations, combined rotation/zoom, shear and parent/child affine composition.
- Introducing a new nested independently transformed and clipped group, rotating that group, changing parent affine state and swapping layer order.
- An unchanged final frame; the estimator must emit no damage and the frame must be unchanged.

Each transition is run with **two independent persistent RGBA caches** after the first full reference: one pasting source-rendered semantic dirty rectangles as single tiles, and another pasting four overlapping tiles for each rectangle.

All unchanged cache pixels are genuinely kept from the previous frame. Each updated dirty rectangle is rasterized afresh by Vello CPU WASM from the new graph. After replay, every premultiplied RGBA channel in the **entire cached frame** is compared against the independent full new-frame reference.

The full reference is used exclusively to confirm coverage and numerical equality **after** selecting operation-derived damage regions; it is never used for damage planning.

## Strict results

| Canvas | Transitions per browser context | Actual WASM partial tile calls | Baseline legacy channel differences per context | Canonical channel differences | Missed changed pixels |
| --- | ---: | ---: | ---: | ---: | ---: |
| 640×400 | 24 | 115 | 58 | **0** | **0** |
| 800×500 | 24 | 115 | 60 | **0** | **0** |
| 1024×640 | 24 | 115 | 60 | **0** | **0** |
| Both contexts, all sizes | **144** | **690** | **356** | **0** | **0** |

**922,232 actually changed reference pixels** were detected within the independently predicted geometry regions. All **690** dirty-tile renders matched the corresponding full-reference pixels, and each accumulated frame matched the full reference exactly. No-op transitions required no repaint.

Damage-area fractions, excluding no-op transitions, from the first browser context:

| Canvas | Smallest nonzero damaged fraction | Largest damaged fraction |
| --- | ---: | ---: |
| 640×400 | 16.7% | 63.7% |
| 800×500 | 10.7% | 47.0% |
| 1024×640 | 6.5% | 28.7% |

These values are conservative **rectangle-area fractions**, not actual rendered-time speedups or transfer reductions.

## Reproducibility and boundaries

- Estimator and scene cases: `compatibility/browser/affine-group-damage.cjs`.
- New experimental Rust export: `compatibility/browser/vello-complex/src/lib.rs`.
- Local module binding: `compatibility/browser/web/aa-precision.html`.
- Browser pixel and cache comparison: `compatibility/browser/test-aa-affine-group-damage.cjs`.
- Pinned-source full compile + real Chromium workflow: `.github/workflows/browser-aa-affine-group-damage.yml`.

Pinned upstream Vello CPU revision: `235739c4f08eb48d900e1512459d453a9ab77f96`, patched **only** in a disposable CI checkout using `compatibility/browser/aa-coverage-internals/patch-upstream.cjs`.

**Known limitations**: Only finite 2D affine matrices under explicit validation constraints, supported Bézier segment and stroke grammar, supported group blend/opacity, simple rectangular group clips and a conservative fixed AA margin have been tested. This does not prove safety for arbitrary scene-graph operations, miter join geometry, pixel filters/shadow expansion, large or degenerate matrices, image/text content, arbitrary clip effects, GPU/Filament composition or native desktop rendering. Production damage tracking and renderer selection are unresolved; `main` is untouched.

**Suggested next boundary:** falsification-oriented tests for extreme/near-singular matrices, transform-dependent stroke join/miter, nested masks and filters; distinguish a true conservative bound from an accidental overestimate, then measure dirty repaint timing in a real editor session. Do not merge to `main` without separate review.
