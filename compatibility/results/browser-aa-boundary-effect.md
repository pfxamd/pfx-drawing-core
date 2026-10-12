# Numerical boundary proof: near-singular affine, sharp miter, alpha mask, Gaussian blur

## Verified outcome — 2026-10-12

- **Passed:** [guarded source-built Chromium replay, run 38276525101](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38276525101). All **6/6** browser-context/canvas checks PASS after precisely selecting full-frame invalidation for unproven subregion paths.
- **Actual pinned-source compiler/WASM build:** [run 38275299670](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38275299670) built successfully; the first browser job in that run failed an unrelated test-only JavaScript scope error. Corrected replay guards exact Git blob hashes for Rust, Cargo, the upstream source patch, trace and browser loader. The temporary Vello CPU source checkout is pinned to `235739c4f08eb48d900e1512459d453a9ab77f96`.
- **Positive evidence:** [JSON for six independent runs, aggregate results, and actual Chromium screenshot](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38276525101/artifacts/11759004128).
- **Negative falsification evidence:** [run 38276036508](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38276036508), [artifact 11758553303](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38276036508/artifacts/11758553303), after the pixel-stride comparison was corrected, proves **1–2 changed RGBA channels** at some subdivided near-singular stroke and alpha-mask dirty regions, despite no missed damage pixels. These failures must **not** be reclassified as byte-exact tiled rendering.
- No merge to `main` and no release/production integration.

## Test scene and exact constraints

The experimental source-built WASM export `render_complex_boundary_effect` draws using the actual pinned Vello CPU APIs:

1. A filled Bézier contour, overlaid by a sharp polyline stroke using **miter joins with limit 12**, with widths changing over time.
2. Finite affine matrices with strong anisotropy, rotation, subpixel translation and scales as low as **0.002** and **0.006** in one axis (near singular, but not mathematically singular).
3. A generated alpha mask using absolute global canvas coordinates, applied through Vello's isolated mask layer API.
4. Actual Vello CPU Gaussian blur applied through a filter layer (radius **5.25**), including masked-and-blurred scenes.

Three canvases: **640×400**, **800×500**, **1024×640**, in two independent Chromium contexts with reversed canvas iteration. Each run uses **14 scene states / 13 transitions**, 2 persistent frame buffers, and two replay layouts. Every successive frame is compared to a freshly rendered full-scene oracle in all premultiplied RGBA channels.

The damage planner `boundary-effect-damage.cjs` reads only the operation's affine matrix, Bézier control points, stroke width, mask/filter mode and movement, not reference pixels. Its conservative miter bound uses `strokeWidth/2 × miterLimit(12) × FrobeniusNorm(linearMatrix) + 20px`; the Frobenius norm bounds the affine maximum stretch. This is valid for the selected miter style and finite path family, not a proof for arbitrary stroke geometries.

## Falsification: where native dirty tiles are not proven safe

The corrected test first used independently generated **four overlapping tiles** even for near-singular and alpha-mask steps. It found:

| Canvas | Failed transition / scene | Changed channels in unsafe subdivided tile | Full-frame cached-frame differences |
| --- | --- | ---: | ---: |
| 640×400 | Transition 6, isolated alpha mask | 1 | 1 |
| 800×500 | Transition 2, highly anisotropic miter stroke | 1 | 1 |
| 800×500 | Transition 6, isolated alpha mask | 1 | 1 |
| 1024×640 | Selected subdivided transitions | 0 | 0 |

These are **real byte-level failures** observed against independent full references, repeated in both Chromium contexts. No changed pixels were missed by the geometry planner; the differences came from **raster numerical equivalence at particular tile boundaries**, not invalidation coverage. A generic ROI safe mode should not be inferred from a single clean probe.

## Fail-closed correction and verified result

If the transition touches either:

- a Gaussian-filtered scene,
- an alpha-masked scene, or
- an affine transform with determinant magnitude below **0.02**,

the damage planner now emits an explicit **entire-canvas invalidation rectangle**. This applies to both prior and next scene states. Crucially, **both replay layouts must rasterize the full canvas once**, instead of splitting a declared full-frame fallback into unsafe smaller subregions. Unaffected affine/miter states continue to use independently rasterized partial tiles where the numerical test established byte equality.

A separate diagnostic crop probe demonstrates that the chosen safe Gaussian ROI helper can source pixels from a full-frame render, but that helper is itself a full-frame raster + crop, **not** incremental blur acceleration.

### Final proof

| Metric, both browser contexts and all canvases | Verified |
| --- | ---: |
| Passing browser/context suites | **6 / 6** |
| Scene transitions | **78** |
| Actually changed pixels, checked against operation-derived invalidation | **1,376,266** |
| Changed pixels missed by damage selection | **0** |
| Independently executed render requests | **162** |
| Actual entire-frame fallback draws | **132** |
| Genuine dirty subregion draws | **30** |
| Corrected raster path mismatched RGBA channels | **0** |
| Accumulated persistent frame-cache mismatches | **0** |
| Legacy local-first comparison differences over the selected requests | **82** |

All scene transitions are checked with complete full-frame comparisons. The final 0 differences are **conditional on this explicit fallback policy**, not evidence that mask/miter/filter rendering independently preserves equality across arbitrary dirty-tile subdivisions.

## Files

- `compatibility/browser/vello-complex/src/lib.rs`: new boundary/effect Vello CPU rendering entrypoint.
- `compatibility/browser/boundary-effect-damage.cjs`: conservative miter bounds, numeric threshold and full-frame fallback selection.
- `compatibility/browser/test-aa-boundary-effect.cjs`: real browser tests, 2 caches, direct rendered tiles, full reference oracle, mask/filter probes, fail-closed semantics and machine-readable evidence.
- `compatibility/browser/web/aa-precision.html`: browser binding.
- `.github/workflows/browser-aa-boundary-effect.yml`: source-built pinned binary, hash-guarded browser-test-only replay, archived positive/negative proof.

## Next gate

The current approach **prioritizes correctness over repaint efficiency** for risky numerical and filter cases. It remains experimental:

- Determine the exact f32, clip-mask and stroke raster stage responsible for the observed 1/255 tile edge differences; prove a true tile-local correction rather than increasing tolerances.
- For blur/other effects, introduce source-halo rasterization and independently verify halo padding under transformed filter kernels before allowing partial invalidation.
- Add adversarial randomized/property-based affine/path/miter tests and a realistic hardware-independent pixel-oracle suite. Native CPU, desktop, real hardware GPU, 2D/3D compositing and latency should be separate performance/reliability gates.

No unsafe universal claim, no main branch merge.
