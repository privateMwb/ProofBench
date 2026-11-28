# Architecture

ProofBench is a static website. There is no server of its own: C++ libraries are compiled to WebAssembly ahead of time, the built files are committed, and every page runs them in the visitor's browser.

## The pipeline

```
libs/<Name>/include/      C++ library (a git submodule, its own repository)
        │
wasm/<name>.cpp           small extern "C" binding, one file per module
        │  scripts/build.sh | build.ps1   (emcc, pinned in .emscripten-version)
        ▼
site/wasm/<name>.js       Emscripten glue (ES module)  ┐ committed to git,
site/wasm/<name>.wasm     the compiled module          ┘ served as-is
        │
site/js/wasm-worker.js    loads one module inside a Web Worker
site/js/wasm-client.js    promise API the pages talk to
        │
site/<name>/index.html    a library page: try it, benchmark it, verify it
```

Why the built files are committed: Vercel cannot compile C++, so it serves exactly what is in git. CI rebuilds from source and fails if a built file is not tracked (`ci.yml`), and the deploy fails if a `wasm/*.cpp` has no built counterpart (`scripts/check-wasm.mjs`, run as the Vercel build command).

## Modules

Every `wasm/<name>.cpp` becomes `site/wasm/<name>.js` + `.wasm`, with an ES-module factory named `create_<name>`. Three naming conventions matter:

| File | Purpose |
|---|---|
| `wasm/<name>.cpp` | The interactive demo: a small C API over one live instance. |
| `wasm/<name>_bench.cpp` | The benchmark module, built on `bench/harness.hpp`. |
| `wasm/<name>_verify.cpp` | The verification module. Built with `-fwasm-exceptions` (the `_verify` suffix switches it on in `build.sh`) so it can inject throws, and with a counting `operator new` so it can count heap allocations. |

`hello.cpp` is the Phase 1 smoke module. It proves the toolchain works and is what `tests/smoke.mjs` loads.

All modules are built with `-std=c++23 -O2 -Wall -Wextra`, `-sMODULARIZE=1 -sEXPORT_ES6=1`, `-sALLOW_MEMORY_GROWTH=1` and `-sENVIRONMENT=web,worker,node`. The `node` target is what lets the tests load the same files the browser does. Every `libs/*/include` directory is added to the include path automatically.

## The worker layer

Running a benchmark on the main thread would freeze the page, so each page talks to its module through a Web Worker:

- `site/js/wasm-worker.js` is generic. On `init` it imports the module, wraps each exported function with `cwrap` using the signatures the page supplies, and on `batch` runs a list of calls and reports the elapsed time.
- `site/js/wasm-client.js` exposes `WasmWorker.create({ moduleUrl, sigs })`, then `batch(calls)`, `call(name, ...args)` and `terminate()`.

Batching matters: one `batch` is one round trip to the worker, so a panel groups a "run" call and the calls that read its results into a single message.

## The panels

Two reusable panels sit on top of the worker, so a new library page is mostly configuration:

- **Benchmark panel** (`site/js/bench-panel.js`, `bench-stats.js`). Runs the library against a baseline with identical keys and operations, in alternating order (A,B then B,A), discarding warm-up rounds, with keys scrambled so neither side benefits from consecutive integers. The operation count is chosen automatically so each sample outlasts the browser's deliberately coarse timer. Results are reported as medians with the middle-50% range, and overlapping ranges are called a tie instead of a win. The C++ side is `bench/harness.hpp`; the baseline for LRUCache is `bench/std_lru.hpp` (a `std::list` plus `std::unordered_map`, given `reserve()` up front so it never rehashes).
- **Verify panel** (`site/js/verify-panel.js`, with the claims in `lrucache-claims.js`). A claim is a sentence from the library's README plus a way to measure it. The C++ module produces raw numbers; a pure JavaScript `evaluate*` function turns them into a verdict (`pass`, `partial` or `fail`) and the sentence the page shows. Keeping the evaluators pure is what lets `tests/lrucache-claims.test.mjs` unit-test the verdict logic without a browser.

LRUCache's four claims are: zero steady-state heap allocations, constant work per operation (counted hash and key-comparison calls, not wall-clock time), strong exception guarantee on insert, and exact hit/miss statistics.

## Tests

`tests/` holds plain Node scripts that load the built WASM from `site/wasm/` (so they test what ships). `npm test` runs them all; each one is a CI step in `ci.yml`. `tests/lrucache.verify.test.mjs` pins the expected verdict of each claim, so if a library regresses (or is fixed) the test says so and has to be updated on purpose. `tests/rulesets.test.mjs` keeps the required status checks in `.github/rulesets/` in sync with the workflow job names.

## Layout reference

| Path | Purpose |
|---|---|
| `libs/` | C++ libraries as git submodules |
| `wasm/` | One binding per module |
| `bench/` | Header-only benchmark harness and the shared baseline LRU |
| `site/` | The static frontend (what Vercel serves) |
| `site/wasm/` | Built modules, committed |
| `site/js/` | Page scripts, the worker layer and the reusable panels |
| `tests/` | Node tests that load the built WASM |
| `scripts/` | `build.sh`, `build.ps1`, `check-wasm.mjs`, `serve.py` |
| `.github/` | Workflows, rulesets, Dependabot, CODEOWNERS, README assets |
| `docs/` | These documents |

## Limits

- Timings are WebAssembly in the browser, not native speed, and browsers round timers on purpose. The panels say so and report medians for that reason.
- A page needs a browser with module workers and WebAssembly exceptions (all current evergreen browsers).
- Built files come from whatever Emscripten built them. The pinned version in `.emscripten-version` is the supported one; see [DEPLOYMENT.md](DEPLOYMENT.md#changing-the-emscripten-version).
