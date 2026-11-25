# ProofBench

Libraries that prove their own claims: run, benchmark and verify C++ libraries live in the browser via WebAssembly.

## Setup (Windows, PowerShell)

```powershell
# One time
git clone https://github.com/emscripten-core/emsdk.git C:\emsdk
cd C:\emsdk
.\emsdk install 3.1.74
.\emsdk activate 3.1.74

# Every new PowerShell window
C:\emsdk\emsdk_env.ps1

# From the project folder
git submodule update --init
.\scripts\build.ps1
node tests\smoke.mjs
node tests\lrucache.test.mjs
node tests\lrucache.fuzz.mjs
node tests\lrucache.bench.test.mjs
node tests\bench-stats.test.mjs
python -m http.server -d site 8000   # open http://localhost:8000
```

On Linux/macOS use `source ~/emsdk/emsdk_env.sh` and `./scripts/build.sh`.

## Layout

| Path | Purpose |
|------|---------|
| `libs/` | C++ libraries as git submodules (each `libs/<name>/include` is on the include path) |
| `wasm/` | One `.cpp` binding per module; each becomes `site/wasm/<name>.js` |
| `site/` | Static frontend, deployed to Vercel (built `site/wasm/` is committed) |
| `site/js/wasm-worker.js`, `wasm-client.js` | Shared Web Worker layer used by every library page |
| `site/js/libraries.js` | Library list for the landing page |
| `site/js/bench-panel.js`, `bench-stats.js` | Reusable benchmark panel and statistics |
| `bench/harness.hpp` | Timer, key generators and the interleaved A/B runner |
| `tests/` | Node tests that load the built WASM |
| `scripts/` | `build.ps1` (Windows) and `build.sh` (Linux/CI) |

## Adding a library

1. `git submodule add <url> libs/<Name>`
2. Write `wasm/<name>.cpp` with a small `extern "C"` API.
3. Add `site/<name>/index.html` and `site/js/<name>.js`, then an entry in `site/js/libraries.js`.
4. Build, test, commit `site/wasm/`.

## Status

- [x] Phase 1: toolchain, CI, deploy
- [x] Phase 2: LRUCache page (try it)
- [x] Phase 3: benchmark harness (LRUCache vs std::list + unordered_map)
- [ ] Phase 4: verify-the-claim panels
- [ ] Phase 5: more libraries
- [ ] Phase 6: polish
