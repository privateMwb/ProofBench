// Loads the built LRUCache module in Node and checks the binding end to end.
import assert from 'node:assert/strict';
import create_lrucache from '../site/wasm/lrucache.js';

const m = await create_lrucache();
const f = (name, ret, args) => m.cwrap(name, ret, args);
const create = f('lru_create', 'number', ['number']);
const put = f('lru_put', 'number', ['number', 'number']);
const evictedKey = f('lru_evicted_key', 'number', []);
const get = f('lru_get', 'number', ['number']);
const peek = f('lru_peek', 'number', ['number']);
const lastValue = f('lru_last_value', 'number', []);
const erase = f('lru_erase', 'number', ['number']);
const snapshot = f('lru_snapshot', 'number', []);
const keyAt = f('lru_key_at', 'number', ['number']);
const valueAt = f('lru_value_at', 'number', ['number']);
const size = f('lru_size', 'number', []);
const capacity = f('lru_capacity', 'number', []);
const hits = f('lru_hits', 'number', []);
const misses = f('lru_misses', 'number', []);
const resize = f('lru_resize', 'number', ['number']);
const clear = f('lru_clear', null, []);
const workload = f('lru_run_workload', 'number', ['number', 'number', 'number', 'number', 'number']);
const wlHits = f('lru_workload_hits', 'number', []);
const wlMisses = f('lru_workload_misses', 'number', []);

// invalid capacities are rejected, not thrown
assert.equal(create(0), 0);
assert.equal(create(-5), 0);
assert.equal(create(2_000_000), 0);

// basic put / order
assert.equal(create(3), 1);
assert.equal(put(1, 10), 0);
assert.equal(put(2, 20), 0);
assert.equal(put(3, 30), 0);
assert.equal(size(), 3);
assert.equal(capacity(), 3);
assert.equal(snapshot(), 3);
assert.equal(keyAt(0), 3);
assert.equal(keyAt(2), 1);
assert.equal(valueAt(1), 20);

// get refreshes recency, so key 2 is evicted first, then 3
assert.equal(get(1), 1);
assert.equal(lastValue(), 10);
assert.equal(put(4, 40), 1);
assert.equal(evictedKey(), 2);
assert.equal(put(5, 50), 1);
assert.equal(evictedKey(), 3);

// peek does not touch stats; misses count
assert.equal(peek(1), 1);
assert.equal(get(2), 0);
assert.equal(get(3), 0);
assert.equal(hits(), 1);
assert.equal(misses(), 2);

// update never evicts and moves the key to the front
assert.equal(put(1, 11), 0);
assert.equal(get(1), 1);
assert.equal(lastValue(), 11);
assert.equal(snapshot(), 3);
assert.equal(keyAt(0), 1);

// erase, resize, clear
assert.equal(erase(1), 1);
assert.equal(erase(1), 0);
assert.equal(size(), 2);
assert.equal(resize(1), 1);
assert.equal(size(), 1);
assert.equal(capacity(), 1);
clear();
assert.equal(size(), 0);
assert.equal(snapshot(), 0);

// workload: invalid args, determinism, monotonic in capacity, skew helps
assert.ok(workload(0, 10, 10, 100, 1) < 0);
assert.ok(workload(5, 10, 10, 301, 1) < 0);
let prev = -1;
for (const cap of [10, 100, 500, 2000, 5000]) {
  const rate = workload(cap, 10000, 200000, 100, 42);
  assert.ok(rate >= prev, `hit rate should not drop as capacity grows (cap ${cap})`);
  assert.equal(wlHits() + wlMisses(), 200000);
  prev = rate;
}
assert.equal(workload(100, 10000, 100000, 100, 7), workload(100, 10000, 100000, 100, 7));
const uniform = workload(1000, 10000, 200000, 0, 42);
const skewed = workload(1000, 10000, 200000, 150, 42);
assert.ok(skewed > uniform + 20, 'skewed traffic should hit far more often than uniform');

console.log('lrucache test passed');
