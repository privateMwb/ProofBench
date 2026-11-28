# Adding a library

A library page is three small things: a C++ binding, a page, and an entry in the library list. This guide uses a library called `HashMapPro` as the example; swap in your own name.

## 1. Add the library as a submodule

```bash
git submodule add https://github.com/privateMwb/HashMapPro libs/HashMapPro
```

`scripts/build.sh` puts every `libs/*/include` directory on the include path, so a header at `libs/<Name>/include/<Dir>/<File>.h` is included as `<Dir>/<File>.h` with no further setup. For example, LRUCache's `include/CachePro/LRUCache.h` is `#include <CachePro/LRUCache.h>`. The library needs an `include/` directory laid out that way; if it does not have one, fix that in the library.

## 2. Write the binding

Create `wasm/hashmappro.cpp`. Keep the API small and plain: `extern "C"` functions taking and returning numbers, because the worker calls them through Emscripten's `cwrap`.

```cpp
#include <emscripten/emscripten.h>
#include <CachePro/HashMapPro.h> // whatever path the library's include/ uses

extern "C" {

EMSCRIPTEN_KEEPALIVE
int hm_size() { /* ... */ }

}
```

The build turns it into `site/wasm/hashmappro.js` and `.wasm` with a factory named `create_hashmappro`.

Use only the library's public API. The point of ProofBench is to exercise the library the way a user would.

Two optional companion modules, by suffix:

- `wasm/hashmappro_bench.cpp` for benchmarks. Include `bench/harness.hpp` for the timer, deterministic key generators and the interleaved A/B runner, and compare against a baseline you define in `bench/` (see `bench/std_lru.hpp`).
- `wasm/hashmappro_verify.cpp` for verification. The `_verify` suffix makes `build.sh` and `build.ps1` pass `-fwasm-exceptions`, which fault injection needs.

## 3. Add the page

1. Create `site/hashmappro/index.html`. Copy `site/lrucache/index.html` and adjust the text.
2. Create `site/js/hashmappro.js` for the interactive demo. Load the module with `WasmWorker.create({ moduleUrl, sigs })` from `site/js/wasm-client.js`, where `sigs` maps each exported function to `[returnType, [argTypes]]`.
3. For a benchmark, call `initBenchPanel(...)` from `site/js/bench-panel.js` with the module URL, the two labels, the workloads and the capacities (see `site/js/lrucache-bench.js`, which is about twenty lines).
4. For verification, write the claims in `site/js/hashmappro-claims.js`: each claim has a measure function that returns raw numbers and a pure `evaluate*` function that turns them into a verdict. Mount it with `site/js/verify-panel.js`.
5. Add the library to `site/js/libraries.js`. The entry is already there with `status: 'soon'` for the planned ones; set it to `'live'` once the page works:

   ```js
   { slug: 'hashmappro', name: 'HashMapPro', category: 'C++ Library', status: 'live',
     blurb: 'Separate-chaining hash map with automatic rehashing.' },
   ```

   The `slug` must match the folder name under `site/`.

## 4. Build, test, commit

```bash
bash ./scripts/build.sh        # or .\scripts\build.ps1 on Windows
node tests/smoke.mjs           # plus your own tests
git add site/wasm/ wasm/ site/ libs/ .gitmodules
```

Add tests in `tests/` that load the built module the way `tests/lrucache.test.mjs` does. A differential test against a simple reference model (see `tests/lrucache.fuzz.mjs`) catches the most bugs per line. Add each new test to `npm test` in `package.json` and as a step in `.github/workflows/ci.yml`.

**Commit the built files.** `site/wasm/hashmappro.js` and `.wasm` (and the `_bench` and `_verify` ones) must be in git or the CI "committed" step fails and Vercel serves a page that errors at runtime.

## Checklist

- [ ] Submodule added; its commit is pushed to the library's own repository
- [ ] `wasm/<name>.cpp` builds with no warnings
- [ ] Page, script and `libraries.js` entry added, `status: 'live'`
- [ ] Tests added and listed in `package.json` and `ci.yml`
- [ ] `site/wasm/` rebuilt and committed
- [ ] `npm run verify` passes
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
