// Runs every claim check against the built WebAssembly module in Node.
// EXPECTED holds the status each claim has today. If a claim changes status (a
// regression, or the library gets fixed) this test fails so the table gets updated on purpose.
import assert from 'node:assert/strict';
import create_verify from '../site/wasm/lrucache_verify.js';
import { CLAIMS, VERIFY_SIGS } from '../site/js/lrucache-claims.js';

const EXPECTED = {
  allocations: 'pass',
  complexity: 'pass',
  exceptions: 'partial', // LRUCache evicts before it constructs the new node. Set to 'pass' once fixed.
  statistics: 'pass',
};

const m = await create_verify();
const fns = {};
for (const [name, [ret, args]] of Object.entries(VERIFY_SIGS)) fns[name] = m.cwrap(name, ret, args);
const worker = { batch: async (calls) => ({ results: calls.map(([name, args]) => fns[name](...args)), ms: 0 }) };

for (const claim of CLAIMS) {
  const result = await claim.run(worker);
  console.log(`${claim.id.padEnd(12)} ${result.status.padEnd(8)} ${result.headline}`);
  assert.notEqual(result.status, 'error', `${claim.id}: ${result.headline}`);
  assert.equal(result.status, EXPECTED[claim.id], `${claim.id} changed status: ${result.headline}`);
}
console.log('lrucache verify test passed');
