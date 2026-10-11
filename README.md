# PFx Drawing Core

Source-first, cross-platform drawing engine research and development.

**Current status:** compatibility lab — no 2D/3D renderer has been selected or approved for integration yet.

This repository will house the PFx drawing orchestration layer and eventually the carefully reviewed source code of the selected open-source engines. The first milestone tests native Linux and browser compatibility **before** any engine sources are adopted into the core.

See [`compatibility/`](compatibility/) for pinned engine sources, isolated build probes, results and explicit limitations. Source acquisition during these experiments does not imply copying or relicensing upstream implementations.

The existing [`pfx-geometry-core`](https://github.com/pfxamd/pfx-geometry-core) remains an independently maintained geometry kernel.
