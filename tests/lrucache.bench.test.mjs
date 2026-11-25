// Loads the built benchmark module in Node and checks the harness contract.
import assert from 'node:assert/strict';
import create_bench from '../site/wasm/lrucache_bench.js';

const m = await create_bench();
const run = m.cwrap('bench_run', 'number', ['number', 'number', 'number', 'number', 'number', 'number']);
const sample = m.cwrap('bench_sample', 'number', ['number', 'number']);
const checksum = m.cwrap('bench_checksum', 'number', ['number']);
const consistent = m.cwrap('bench_consistent', 'number', []);
const resolution = m.cwrap('bench_resolution_ns', 'number', []);

// invalid parameters are rejected
assert.equal(run(3, 1000, 1000, 3, 100, 1), -1);
assert.equal(run(0, 8, 1000, 3, 100, 1), -1);
assert.equal(run(0, 1000, 10, 3, 100, 1), -1);
assert.equal(run(0, 1000, 1000, 2, 100, 1), -1);
assert.equal(run(1, 1000, 1000, 3, 301, 1), -1);
assert.equal(run(0, 400000, 1000, 3, 100, 1), -1);

const OPS = 50000;
const CAP = 2000;
for (const workload of [0, 1, 2]) {
  assert.equal(run(workload, CAP, OPS, 5, 100, 42), 5, `workload ${workload}`);
  for (const impl of [0, 1]) {
    for (let i = 0; i < 5; i++) {
      const s = sample(impl, i);
      assert.ok(Number.isFinite(s) && s > 0, `workload ${workload} impl ${impl} sample ${i}: ${s}`);
    }
  }
  assert.ok(sample(0, 5) < 0 && sample(2, 0) < 0 && sample(0, -1) < 0);
  assert.equal(consistent(), 1, `workload ${workload}: implementations disagree`);
  assert.equal(checksum(0), checksum(1));
  const hits = Math.floor(checksum(0) / 16777216);
  if (workload === 0) assert.equal(hits, OPS, 'every lookup should hit');
  if (workload === 1) assert.ok(hits > 0 && hits < OPS, 'cache-aside should mix hits and misses');
  if (workload === 2) assert.equal(checksum(0), CAP, 'cache should stay full');
}

// deterministic for a fixed seed
run(0, CAP, OPS, 3, 100, 7);
const first = checksum(0);
run(0, CAP, OPS, 3, 100, 7);
assert.equal(checksum(0), first);

assert.ok(resolution() > 0);
console.log('lrucache bench test passed');
