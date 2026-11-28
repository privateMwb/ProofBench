# Security Policy

## Supported versions

ProofBench is a small, individually maintained project. Security fixes are made on the `main` branch and shipped in the next release; older releases are not patched.

| Version | Supported |
|---|:-:|
| `main` and the latest release | ✅ |
| Anything older | ❌ |

## Reporting a vulnerability

**Please do not report a suspected vulnerability in a public issue, pull request or discussion.** Use GitHub's private reporting so a fix can be prepared before the details are public:

1. Open this repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe the problem.

A useful report says what is affected (a page, the worker layer, a binding, a workflow, a built binary), how to reproduce it and what an attacker gains.

## What is in scope

- **The built WebAssembly.** `site/wasm/` holds compiled binaries that are committed to git and served as-is. CI rebuilds them and checks that every built file is tracked, but it does not compare the rebuilt bytes with the committed ones. A committed binary that does not correspond to its source in `wasm/` and `libs/` is in scope, as is anything that lets a page load a module from another origin.
- **The worker layer.** `site/js/wasm-worker.js` imports the module URL a page gives it and calls exported functions by name. Ways to make it run something the page did not intend are in scope.
- **Memory-safety bugs in a binding** (`wasm/*.cpp`) that can be triggered from the page's inputs, such as a capacity, key or operation count. The bindings validate these; a bypass is in scope.
- **HTML injection.** The site builds its pages with text nodes and does not use `innerHTML`. A way to get markup or script into a page is in scope.
- **Workflow and supply-chain issues** in `.github/` (token permissions, unpinned or untrusted actions) and in the pinned toolchain in `.emscripten-version`.
- **Third-party loads.** The site loads nothing from outside its own origin. Anything that introduces such a load is in scope.

## What is out of scope

- **Bugs inside a library.** The C++ libraries under `libs/` are separate repositories with their own security policies; report them there. If a ProofBench page makes a library bug reachable, report that here as well.
- **Benchmark results.** Timings are WebAssembly in a browser, not native speed, and they vary by machine. A surprising number is not a vulnerability.
- Reports that need a modified local copy of the site or a compromised browser.

## Handling

Reports are handled on a best-effort basis by a single maintainer. You will be told whether the report is accepted and, if so, credited in the release notes unless you prefer otherwise.
