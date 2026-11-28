# Contributing to ProofBench

Issues and pull requests are welcome. This guide covers setup, what CI checks and how a change gets merged.

## Setting up

You need Node.js 20+ and, to rebuild the WebAssembly, the pinned Emscripten (see `.emscripten-version`). Without Emscripten you can still run the tests and the site, because the built files are committed.

```bash
git clone --recurse-submodules https://github.com/privateMwb/ProofBench.git
cd ProofBench
npm ci                      # installs the linter only
python scripts/serve.py     # http://localhost:8000
```

Forgot `--recurse-submodules`? Run `git submodule update --init`.

To rebuild the WASM, install the pinned Emscripten and activate it, then build:

```bash
# Linux / macOS
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
~/emsdk/emsdk install "$(cat .emscripten-version)"
~/emsdk/emsdk activate "$(cat .emscripten-version)"
source ~/emsdk/emsdk_env.sh
./scripts/build.sh
```

```powershell
# Windows (PowerShell)
C:\emsdk\emsdk_env.ps1
.\scripts\build.ps1
```

The README has the one-time Windows install.

## The workflow

1. Create a branch from `main`.
2. Make your change.
3. If you touched anything under `wasm/`, `bench/` or `libs/`, rebuild the WASM and **commit the changed files in `site/wasm/`**.
4. Run `npm run verify`.
5. Open a pull request. CI runs on it; merge once everything passes.

## Checks to run locally

CI enforces all of these (`npm run verify` runs them together):

```bash
npm run check   # every wasm/*.cpp has a built module in site/wasm/
npm run lint    # oxlint, warnings are errors in CI
npm test        # the Node tests, against the built WASM
```

## Built files are committed on purpose

Vercel cannot compile C++, so it serves exactly what is in git. That means a change to C++ is not finished until the rebuilt `site/wasm/*.js` and `*.wasm` are committed too. CI rebuilds from source and fails with "built but not committed" if you forget. Don't hand-edit anything in `site/wasm/`.

## Library changes

The libraries under `libs/` are git submodules, each its own repository. Fix a library in **its** repository, not here:

1. Open and merge the pull request in the library's repository.
2. Here, update the submodule pointer (`git submodule update --remote libs/<Name>`), rebuild the WASM and commit the pointer and `site/wasm/` together.

Merge the library first. A pointer to a commit that is not on the library's remote cannot be checked out, so CI fails.

If a change flips a verification verdict, `tests/lrucache.verify.test.mjs` fails until you update the expected verdict. Do that deliberately and mention it in the pull request.

## Adding a library

See [docs/ADDING_A_LIBRARY.md](docs/ADDING_A_LIBRARY.md).

## Code changes

- Changes to `scripts/`, `wasm/`, the worker layer (`site/js/wasm-worker.js`, `wasm-client.js`), `.github/` and `vercel.json` are owned by the maintainer in [CODEOWNERS](.github/CODEOWNERS).
- Build DOM with the helpers in `site/js/dom.js` and set text, not HTML. Don't introduce `innerHTML`, `eval` or `document.write`.
- Don't add third-party scripts, fonts or other network loads to the site. Today it loads nothing from outside its own origin; keep it that way.
- Bindings use only the library's public API, so a page exercises the library the way a user would.
- Add or update tests in `tests/` for behaviour changes, and add new test files to `npm test` in `package.json` and to `.github/workflows/ci.yml`.
- Add a line to `CHANGELOG.md` under `[Unreleased]`.

## Reporting security issues

Please don't open a public issue. See [SECURITY.md](SECURITY.md).
