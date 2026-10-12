# Canonical global Bézier flattening versus local dirty-region rasterization

## Verified outcome — 2026-10-12

- [Source-built test 38252020655](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38252020655): both pinned-source Vello CPU WASM build and browser verification successful.
- [Expanded-area browser replay 38252702790](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38252702790): **6/6 cases passed**, using the exact previously built instrumented Vello WASM. [Detailed JSON proof](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38252702790/artifacts/11749356508).
- [Source build log, exact upstream patch and WASM](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38252020655/artifacts/11748401515).
- Under the tested scenario, **all four RGBA channels match byte-for-byte** against an independently rerendered full-canvas reference for the new canonical method. Previously observed 1/255 antialiasing deviations disappeared.
- This is only an experimental Vello CPU browser pathway. No production PFx drawing engine, Vello GPU/Filament interoperability, physical GPU speed, or native GPU equivalence is established.

## Tested change

The original (control) pathway applies the tile origin translation before flattening and f64-to-f32 conversion, then rasterizes the resulting tile-local segments. In the new (canonical) pathway, the experimental Vello `StripGenerator::generate_filled_path` patch:

1. Takes the same path and reconstructs an *absolute global* transform from the tile-local transform and origin.
2. Flattens the path in **exactly the same global 800×500 coordinate frame and culling rectangle as the full reference**, converting the resulting endpoints to `f32` only once in that global frame.
3. Subtracts the tile origin from the resulting f32 line endpoints, and passes the line segments through the unchanged Vello tile, strip, coverage, and quantization stages.

All existing tests and public render exports remain available. The original per-tile math is still directly selectable as a control; no scene-code-path changes or output substitutions are allowed.

**Major limitation:** the global cull bbox is explicitly **800×500** for this proof. The patch only affects *filled paths*, not strokes, masks, arbitrary scene sizes, or arbitrary user transformations. It is not a reusable/general-purpose implementation yet.

## Pixel verification

- Independent full scene: 800×500.
- Common intersection of three dirty-region canvases: **(449,97) to (784,352)**, or 335×255 pixels. The region checks every pixel and RGBA channel, not samples.
- Tile origins: (448,96), (449,97), (432,80). Four reference frames 0,43,97,159.
- Workloads: single Bézier blob A, single Bézier blob B, full combined scene (including overlapping fills and static bars).
- Two separate browser contexts per workload; reverse order on the second repetition.
- The same independent full frame is used for both legacy and canonical tile comparisons. Full-frame canonical versus legacy and retained original reference export are also separately checked and both yielded **zero changed channels**.

Each result below is the four-frame × three-origin total for **one browser context**. The second context reproduced the same counts.

| Scene | Legacy mismatched RGBA channels | Canonical mismatched RGBA channels | Legacy differing pixels | Canonical differing pixels |
|---|---:|---:|---:|---:|
| Single Bézier A | 45 | **0** | 15 | **0** |
| Single Bézier B | 160 | **0** | 40 | **0** |
| Complete 2D mixed geometry | 248 | **0** | 98 | **0** |
| **Total** | **453** | **0** | **153** | **0** |

The expanded replay compares **6,150,600 pixels, 24,602,400 RGBA channels per method**, including both repeated contexts. **No channel differs in any canonical comparison.** Each fully drawn legacy baseline still reproduces its original reference output, establishing that this experiment did not silently change the original control.

### Intermediate line geometry confirmation

At frame 97 and original tile origin, the canonical tile reproduces all global line endpoints of the full-frame reference (after adding the origin and f32 re-rounding):

- Single A: **40/40** segments match, maximum restored coordinate delta **0**.
- Single B: **41/41** segments match, maximum restored coordinate delta **0**.

This validates global flatten consistency for the inspected segments; it does not prove other paths and clipping configurations behave identically.

## CPU-side call measurements

The expanded replay measured 36 synchronous raster-call samples per mode after six warmups, with alternating call orders. Medians across six isolated scenario medians (milliseconds):

| Mode | Median CPU-side WASM call | Median of per-run p95 |
|---|---:|---:|
| Existing local 336×256 tile | 0.3 ms | 0.5 ms |
| **Canonical global-flatten 336×256 tile** | **0.3 ms** | **0.4 ms** |
| Full 800×500 reraster | 1.2 ms | 1.5 ms |

The first source-build run returned about 0.5–0.7 ms per local tile for both modes and 2.0–2.3 ms for full frames. This is run-to-run CI variability. **There is no established universal speedup** between the two partial-render methods. The observed median overhead was not distinguishable in this workload.

RGBA bytes per call are 344,064 for tile rasterization and 1,600,000 for full rasterization. This counts allocated/copied CPU-side RGBA results, **not physical GPU transfers**.

## Reproduction and checks

- Branch: `experiment/browser-aa-global-flatten`.
- Diagnostic upstream patch: `compatibility/browser/aa-coverage-internals/patch-upstream.cjs`.
- Capture switch: `compatibility/browser/aa-coverage-internals/pfx_trace.rs`.
- Vello browser exports: `compatibility/browser/vello-complex/src/lib.rs` and `compatibility/browser/web/aa-precision.html`.
- Full-area proof test: `compatibility/browser/test-aa-global-flatten.cjs`.
- CI build and artifact replay: `.github/workflows/browser-aa-global-flatten.yml`.

The initial run compiles from exact Vello source SHA `235739c4f08eb48d900e1512459d453a9ab77f96`; the replay checks Git blob hashes for Rust source, Cargo dependency manifest, upstream diagnostic patch and HTML exports before using the prior source-built WASM. It never silently reuses outdated binaries when source code changes.

## What remains unproven

This is a *successful narrow correction for the tested vector-fill workload*, not a finished dirty-region algorithm. Before extending it beyond the experiment, test arbitrary affine transforms, noncanonical canvases, thick stroked and clipped paths, offscreen geometry/winding, text, gradients, antialiasing near all tile borders, different SIMD pipelines, and overlapping dirty-region repaint sequences. Separate measures are needed for actual browser 2D+3D compositing, native desktop builds and hardware GPU integration.

**No change to `main`; no final engine choice or merger.**
