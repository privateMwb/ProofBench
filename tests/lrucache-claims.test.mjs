// Unit tests for the claim evaluators, using measurements captured from a native run
// plus hand-made failures. No WebAssembly needed.
import assert from 'node:assert/strict';
import { evaluateAlloc, evaluateProbe, evaluateExc, evaluateStats, PROBE_CAPACITIES } from '../site/js/lrucache-claims.js';

// ---- allocations
const lru = (o = {}) => ({ construct: 2, warmup: 0, steady: 0, frees: 0, ops: 200000, size: 10000, ...o });
const base = (steady) => ({ construct: 1, warmup: 40000, steady, frees: steady, ops: 200000, size: 10000 });
const allocRaw = (over = {}) => ({
  selftest: 3, capacity: 10000,
  rows: [0, 1, 2, 3].map((workload) => ({ workload, ok: true, lru: lru(), base: base(workload === 3 ? 0 : 400000) })),
  ...over,
});
let r = evaluateAlloc(allocRaw());
assert.equal(r.status, 'pass');
assert.match(r.headline, /^0 heap allocations across 800,000 steady-state operations/);
assert.equal(r.tables[0].rows.length, 4);

const leaky = allocRaw();
leaky.rows[1].lru.steady = 17;
r = evaluateAlloc(leaky);
assert.equal(r.status, 'fail');
assert.match(r.headline, /17 times .*Cache-aside/);

const notFull = allocRaw();
notFull.rows[0].lru.size = 9000;
assert.equal(evaluateAlloc(notFull).status, 'fail');
assert.equal(evaluateAlloc(allocRaw({ selftest: -1 })).status, 'error');
const blind = allocRaw();
blind.rows.forEach((x) => { x.base.steady = 0; });
assert.equal(evaluateAlloc(blind).status, 'error');
const rejected = allocRaw();
rejected.rows[2].ok = false;
assert.equal(evaluateAlloc(rejected).status, 'error');

// ---- O(1)
const flatRow = (capacity) => ({ capacity, ok: true, eq: [1, 0, 1, 0, 0], hash: [1, 1, 1, 1, 1] });
r = evaluateProbe({ rows: PROBE_CAPACITIES.map(flatRow) });
assert.equal(r.status, 'pass');
assert.match(r.headline, /flat from 100 to 300,000 entries.*exactly one hash call per operation/);

const growing = PROBE_CAPACITIES.map((c, i) => ({ ...flatRow(c), eq: [1 + i * 2, 0, 1, 0, 0] }));
r = evaluateProbe({ rows: growing });
assert.equal(r.status, 'fail');
assert.match(r.headline, /get \(hit\).*grew from 1\.00 to 9\.00/);

const twoHashes = PROBE_CAPACITIES.map((c) => ({ ...flatRow(c), hash: [1, 1, 1, 1, 2] }));
r = evaluateProbe({ rows: twoHashes });
assert.equal(r.status, 'pass');                     // still O(1), just not the "exactly one hash" bonus
assert.doesNotMatch(r.headline, /exactly one hash/);
assert.equal(evaluateProbe({ rows: [{ ...flatRow(100), ok: false }] }).status, 'error');

// ---- exceptions (capacity 4: fill 0..3 have room, fill 4 is full)
const excRow = (op, fill, over = {}) => ({ op, fill, ok: true, points: 1, unchanged: 1, changed: 0,
  sizeBefore: -1, sizeAfter: -1, lostKey: -1, usable: 1, ...over });
const excRows = (fullBroken) => ['put', 'emplace'].flatMap((op) => [0, 1, 2, 3, 4].map((fill) =>
  fill === 4 && fullBroken ? excRow(op, 4, { unchanged: 0, changed: 1, sizeBefore: 4, sizeAfter: 3, lostKey: 2 }) : excRow(op, fill)));
r = evaluateExc({ capacity: 4, rows: excRows(false) });
assert.equal(r.status, 'pass');
r = evaluateExc({ capacity: 4, rows: excRows(true) });
assert.equal(r.status, 'partial');
assert.match(r.headline, /Holds while the cache has room.*4 entries became 3 and key 2/);
assert.ok(r.tables[0].rows.some((row) => /No: 4 entries became 3, key 2 lost/.test(row[3])));
const roomBroken = excRows(false);
roomBroken[1] = excRow('put', 1, { unchanged: 0, changed: 1, sizeBefore: 1, sizeAfter: 0 });
assert.equal(evaluateExc({ capacity: 4, rows: roomBroken }).status, 'fail');
const noPoints = excRows(false);
noPoints[0].points = 0;
assert.equal(evaluateExc({ capacity: 4, rows: noPoints }).status, 'error');

// ---- statistics
const good = { ok: true, v: [66645, 133355, 66645, 133355, 33.3225, 33.3225, 0, 0, 0] };
assert.equal(evaluateStats(good).status, 'pass');
assert.equal(evaluateStats({ ok: true, v: [66645, 133355, 66644, 133356, 33.3225, 33.322, 0, 0, 0] }).status, 'fail');
assert.equal(evaluateStats({ ok: true, v: [66645, 133355, 66645, 133355, 33.3225, 33.3225, 3, 0, 0] }).status, 'fail');
assert.match(evaluateStats({ ok: true, v: [66645, 133355, 66645, 133355, 33.3225, 33.3225, 0, 2, 5] }).headline, /peek moved a counter; resetStats/);
assert.equal(evaluateStats({ ok: false, v: [] }).status, 'error');

console.log('lrucache-claims test passed');
