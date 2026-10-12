# Browser isolated-vs-combined 2D/3D workload comparison

**Status: awaiting workflow completion. Do not use numbers until verified.**

This is a follow-on **experiment**, not a renderer selection or production benchmark.
The executable test and uploaded JSON are the evidence. Replays pinned source-built
Vello CPU-WASM and Filament WebGL2-WASM binaries originally produced by
[run 38183319164](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38183319164).

## Experimental design

- New `compare.html` loads only the engine required by its URL mode.
- `2d`: Vello CPU WASM generates **one** 800 x 500 transparent RGBA image,
  uploaded with Canvas2D `putImageData` once; remaining callbacks are idle RAF ticks.
  Filament runtime is not downloaded or initialized.
- `3d`: source-built Filament draws the same animated 24-vertex perspective cube
  on a WebGL2 canvas, with no Vello module/wasm fetch or initialization.
- `mixed`: source-built Filament animation plus the exact static Vello CPU/WASM
  overlay in a separate transparent Canvas2D.
- Each mode uses a new browser context and is repeated **3 times** in alternating
  order: `2d,3d,mixed`, `mixed,2d,3d`, `3d,mixed,2d`.
- Each case runs **240** requestAnimationFrame iterations (40 warmup / 200 sampled),
  totaling **2160 frames** and 9 isolated runs.

## Captured metrics and assertions

Every case saves a screenshot and JSON with renderer initialization states, asset
requests, pixel proofs, 3D motion differences, CPU-side `renderer.render` call
distributions, RAF callback interval distributions, Vello one-shot raster and
Canvas2D upload call durations, browser JavaScript heap after frame 40 and frame 240,
and summed Chromium process-tree RSS (Linux `ps`).

The test rejects leaked cross-mode module requests, runtime/HTTP errors,
off-origin requests, missing Vello-painted pixels, nonmoving Filament geometry
and incomplete animations. Aggregate medians are computed from three independent
contexts per mode.

## Measurement boundaries

These are **different intentional workloads** and not an apples-to-apples
steady-state 2D throughput test: the Vello source layer is a static render,
whereas Filament animates every 3D frame.

The display compositor is controlled by Chromium; no GPU context or texture is
shared. Therefore the observed mixed vs 3D delta is only an exploratory
browser-result comparison, **not an isolated compositor-cost measurement**.

- Chromium runs with **SwiftShader software WebGL2** on GitHub-hosted Linux.
- `renderer.render` measures CPU submission, not GPU completion.
- RAF callback spacing also reflects scheduler/runner load; do not call it actual GPU FPS.
- CDP JavaScript heap is not total process, WASM heap or GPU memory.
- Linux RSS summed across subprocesses **double-counts shared mappings**; it is
  not distinct physical memory or VRAM.
- Software renderer, artifact replay and runner contention limit reproducibility.
  Later compare on real GPU with native GPU timing, browser process stats and
  isolated compositing traces before any architecture choice.
- Engine licenses, GPU recovery, dense workloads and desktop GPU paths remain outside
  this evidence gate; no change to `main` or PFx Geometry Core.

[Previous verified 1200-frame stability report](browser-stability-performance.md).
