# Deployment

ProofBench is a static site. Vercel serves the `site/` folder straight from git; nothing is compiled on the host.

## How the deploy works

`vercel.json`:

```json
{
  "buildCommand": "node scripts/check-wasm.mjs",
  "outputDirectory": "site"
}
```

- **Build command.** `scripts/check-wasm.mjs` fails the deploy if any `wasm/<name>.cpp` has no `site/wasm/<name>.js` and `.wasm`. Vercel cannot compile C++, so a missing built file would otherwise ship as a page that fails at runtime.
- **Output directory.** `site/`, as committed, built WebAssembly included.

So the rule is: **rebuild locally or in CI, commit `site/wasm/`, then push.**

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

1. Checks out the repository with submodules.
2. Installs the Emscripten version pinned in `.emscripten-version`.
3. Builds every module with `scripts/build.sh`.
4. Fails if a built file is not tracked by git ("built but not committed").
5. Runs the Node tests against the built files.

Other workflows: `lint.yml` (oxlint), `codeql.yml` (JavaScript security analysis, weekly as well), `release.yml` (tagged releases) and Dependabot for Actions, npm and the `libs/` submodules.

## Updating a library

Each library is its own repository, pulled in as a submodule. When a library changes:

1. Merge the change in the library's repository first. If its `main` is protected, that means a pull request there.
2. In ProofBench, update the submodule and rebuild:

   ```bash
   git submodule update --remote libs/LRUCache
   bash ./scripts/build.sh
   npm test
   ```

3. Commit the new submodule pointer **and** the rebuilt `site/wasm/` together.

Do the steps in that order. If ProofBench points at a submodule commit that is not on the library's remote yet, CI cannot check it out and fails. Dependabot opens these pointer updates for you weekly; rebuild and commit `site/wasm/` on its branch before merging, because the built files embed the library.

If a verification claim changes verdict (a regression, or a fix such as LRUCache's exception guarantee), `tests/lrucache.verify.test.mjs` fails until its expected verdict is updated. That is intentional.

## Changing the Emscripten version

The version is pinned in `.emscripten-version` and used by CI and the build scripts, which warn on a mismatch. To change it:

1. Edit `.emscripten-version`.
2. Install it locally (`emsdk install <version>`, `emsdk activate <version>`).
3. Rebuild everything, run `npm test`, and commit the new `site/wasm/`.

Output from a different version still works in the browser, but it will not be byte-identical to what CI builds.

## Releases

Pushing a tag that starts with `v` runs `release.yml`, which verifies the tree and publishes a GitHub Release with the finished site (`site/`) attached as a zip.

```bash
# Update CHANGELOG.md, optionally write .github/releases/v0.5.0.md, merge, then:
git tag v0.5.0
git push origin v0.5.0
```

- Release notes come from `.github/releases/<tag>.md` when it exists; otherwise GitHub generates them from the merged pull requests.
- A tag with a hyphen (`v0.5.0-rc.1`) is published as a pre-release.
- Tags starting with `v` are protected from deletion and moves by `.github/rulesets/release-tags.json`.

## Hosting somewhere else

The zip attached to each release is the whole site. Any static host works if it:

- serves `.wasm` files as `application/wasm`,
- serves `.js` modules as a JavaScript MIME type (module workers refuse anything else),
- serves over HTTPS or from `localhost`.

Locally, `python scripts/serve.py` does all three and disables caching (http://localhost:8000).

## Repository settings the files cannot switch on

These live in GitHub's settings, not in the repository:

- **Rulesets.** Settings → Rules → Rulesets → Import a ruleset, once each for `.github/rulesets/main-protection.json` and `release-tags.json`. The required check names must match the workflow job names; `tests/rulesets.test.mjs` verifies that.
- **Private vulnerability reporting.** Settings → Code security → enable it, so [SECURITY.md](../SECURITY.md) works.
- **Dependabot alerts.** Enable alongside version updates.
- **Vercel.** Import the repository, choose the "Other" framework preset, and leave the build command and output directory to `vercel.json`. Nothing under `libs/` is compiled on Vercel, so it does not need the submodules.
