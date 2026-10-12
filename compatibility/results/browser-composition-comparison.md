# Browser isolated-vs-combined 2D/3D workload comparison

## Verified outcome — 2026-10-12

- **CI run:** [38230352604](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38230352604) — completed **SUCCESS**.
- **Raw evidence:** [19-file artifact 11738515473](https://github.com/pfxamd/pfx-drawing-core/actions/runs/38230352604/artifacts/11738515473) — 9 PNGs, 9 per-run JSONs and 1 aggregate JSON.
- **Tested code:** \`07a7fea3c60c61119ffeadc25c453866ba056263\`.
- **Assertions:** 9/9 cases, 2160/2160 frames; both engine-isolation checks, zero browser errors, off-origin requests and unexpected context loss. Dynamic cube and 2D pixels were verified from screenshots. The mixed screenshot was inspected after download.

The table shows **median values across 3 runs per mode**, NOT hardware measurements:

| Observed measure | Vello CPU 2D only | Filament 3D only | Vello + Filament |
|---|---:|---:|---:|
| Completed frames | 720 | 720 | 720 |
| RAF callback interval p95, ms | 16.7 | 16.8 | 16.8 |
| Filament renderer CPU call p95, ms | n/a | 0.5 | 0.5 |
| JS heap at 240 frames, bytes | 1,978,596 | 3,945,756 | 3,814,936 |
| Sum of Chromium subprocess RSS, KiB | 430,700 | 486,144 | 498,672 |
| Vello one-shot CPU raster, ms | 9.2 | n/a | 6.5 |
| Canvas2D image upload call, ms | 4.3 | n/a | 3.6 |

At 800 × 500 RGBA, the one-time raster buffer is **1,600,000 bytes**.
The observed median summed Chromium process RSS is **12,528 KiB higher** in
mixed than 3D alone; it includes browser processes and multiply-counted
shared resident pages, varies with repeated-run order and is **not** a
measurement of dedicated GPU memory or a causal compositor allocation.

The test page only rerasterizes and uploads Vello at initialization, so the
matching 3D render-call p95 values say **nothing** about dynamic mixed-frame
performance or data transfer when the vector layer changes each frame.
In particular no conclusion that shared-device composition would be faster,
slower or preferable is justified by this result.

**Decision: maintain the experiment; no engines selected, no shared GPU
context proven and no production architecture approved.** The next research
gate needs a moving 2D layer with per-frame upload, a controlled direct
compositor measurement and a real hardware GPU comparison.


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
