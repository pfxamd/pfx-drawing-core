# Verified engine-source compatibility results

## Build and browser evidence

These are observations from real GitHub Actions jobs, not assumed interoperability.

| Source engine / target | Evidence | Result | Does NOT establish |
|---|---|---|---|
| Skia native Linux CPU raster | [Source-probe run](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38182365050) | PASS; produced `skia-cpu.ppm` from source-built `libskia.a`, with asserted RGBA sample pixels | GPU backend, browser renderer, 2D/3D composition |
| Vello CPU native Linux raster | [Source-probe run](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38182365050) | PASS; source-built raster image `vello-cpu.ppm`, checked magenta and transparent pixels | Large-scene throughput or GPU performance |
| Vello CPU browser module | [Source-probe run](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38182365050) | PASS; compiler type-check for wasm32 | Runtime execution |
| Vello GPU WebGL2 browser module | [Source-probe run](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38182365050) | PASS; compiler type-check for wasm32 | Actual GPU rendering or shared context |
| Filament native Linux | [Source-probe run](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38182365050) | PASS; compiled `libfilament.a` from source | WebAssembly runtime, scene creation, GPU rendering |
| Vello CPU WebAssembly runtime in Chromium | [Isolated browser proof](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38183858883) | PASS; independently source-built `pfx_vello_overlay_bg.wasm`; Chromium rendered 800x500 pixels, verified opaque white [255,255,255,255], opaque magenta [255,0,255,255], transparent [0,0,0,0], no browser errors; screenshot attached as CI artifact | Filament interoperation, GPU rendering, production performance |

### Pinned upstream commits

- Skia: `b23ddbff12658185f0d506befec22a84f8b8c03b`
- Filament: `764fe6cac9bdb4ba24d3d852344dfa04a5f70f75`
- Vello: `235739c4f08eb48d900e1512459d453a9ab77f96`

See `compatibility/sources.json` for descriptions and build paths.

### Integration still NOT verified

The browser-composition experiment is staged on
[`experiment/browser-integration`](https://github.com/pfxamd/pfx-drawing-core/tree/experiment/browser-integration).
A full run must **render a scene in source-built Filament and source-built Vello on the same page**,
check screenshot pixels and collect logs. The initial browser design uses **separate canvases**,
not shared GPU resources. It cannot be used to claim seamless GPU state sharing or absence of
readbacks/uploads. Separate GPU-resource ownership and color-profile handling still need dedicated
tests; integrated performance is unknown.

### Attribution and source-control gate

No third-party engine source has been adopted into the PFx core.
Source is fetched by pinned SHA during compatibility builds.
Prior to vendoring or modifying, separately audit license texts for each selected engine **and its
transitive dependencies**, fix build tooling and hashes, confirm native/browser reproducibility
and preserve original notices and provenance.

**Decision status: unselected.** Build/isolated-render success is not a 2D/3D engine selection.
