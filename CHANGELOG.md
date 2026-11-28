# Changelog

All notable changes to ProofBench are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

ProofBench has not made a tagged release yet. Everything so far is listed under Unreleased, grouped by the phases in the README's status list.

## [Unreleased]

### Added

- Project documents: `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`, this changelog, and `docs/` (`ARCHITECTURE.md`, `ADDING_A_LIBRARY.md`, `DEPLOYMENT.md`). The README was rewritten.
- `.github/`: `CODEOWNERS`, `dependabot.yml` (GitHub Actions, npm and the `libs/` submodules), banner, divider and back-to-top assets, and two rulesets: `main-protection.json` (pull requests plus the required checks) and `release-tags.json` (protects `v*` tags from deletion and moves).
- GitHub Actions: `lint.yml` (oxlint), `codeql.yml` (JavaScript, also weekly) and `release.yml` (tagged releases with the site attached as a zip). `ci.yml` gained a read-only token, a concurrency group and a stable job name ("Build WASM and test") so a ruleset can require it.
- `tests/rulesets.test.mjs`: fails if a required status check in `.github/rulesets/` is not the name of a workflow job.
- `package.json` scripts (`check`, `lint`, `test`, `verify`), an oxlint config (`.oxlintrc.json`) and `.editorconfig`.
- **Phase 4: verify panel.** `wasm/lrucache_verify.cpp` and the reusable verify panel check four of LRUCache's README claims live: zero steady-state heap allocations, constant work per operation, strong exception guarantee on insert, and exact hit/miss statistics. The claim evaluators are pure functions with their own tests.
- `scripts/check-wasm.mjs`, run as the Vercel build command, and a CI step that fails when a built WASM file is not committed.
- **Phase 3: benchmark harness.** `bench/harness.hpp` (timer, deterministic key generators, interleaved A/B runner), the shared baseline in `bench/std_lru.hpp`, automatic operation counts and scrambled keys, and the reusable benchmark panel with a summary that calls overlapping ranges a tie.
- **Phase 2: LRUCache page.** An interactive demo and a hit-rate workload runner (uniform to Zipf-skewed traffic).
- **Phase 1: C++ to WebAssembly pipeline.** `scripts/build.sh` and `build.ps1`, a pinned Emscripten (`.emscripten-version`), the generic worker layer (`wasm-worker.js`, `wasm-client.js`), a smoke-test module, the landing page and Vercel deployment.

### Changed

- The LRUCache submodule was updated to a version whose `put()` and `emplace()` build the new node before evicting (see Fixed). The built WASM was rebuilt against it.
- The verification test now expects the exception-guarantee claim to `pass` (it was pinned to `partial` until the fix).

### Fixed

- LRUCache's strong exception guarantee on insert. The verify panel showed it holding only while the cache had room: an insert into a full cache evicted the least recently used entry before the new one was built, so a throwing constructor lost an entry ("4 entries became 3"). The library now keeps one spare pool slot, builds the new node first and evicts afterwards, so a throw leaves the cache unchanged. The fix is in the LRUCache repository; this project picked it up through the submodule.
- The CI and deploy failure "built but not committed": `site/wasm/lrucache_verify.js` and `.wasm` had been built but never committed.

[Unreleased]: https://github.com/privateMwb/ProofBench/commits/main
