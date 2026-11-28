// Fails when a wasm/<name>.cpp source has no built counterpart in site/wasm/.
// Vercel cannot compile C++, so it only serves what is committed: a missing built
// file means a page that fails at runtime. Run by Vercel as the build command
// (see vercel.json), so a deploy with missing modules fails loudly instead.
import { existsSync, readdirSync } from 'node:fs';

const names = readdirSync('wasm').filter((f) => f.endsWith('.cpp')).map((f) => f.slice(0, -'.cpp'.length));
const missing = [];
for (const name of names) {
  for (const ext of ['js', 'wasm']) {
    const file = `site/wasm/${name}.${ext}`;
    if (!existsSync(file)) missing.push(file);
  }
}
if (missing.length > 0) {
  console.error('Built WebAssembly files are missing. Run scripts/build.ps1, then commit site/wasm/:');
  for (const f of missing) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`ok: all ${names.length} WebAssembly modules are present (${names.join(', ')})`);
