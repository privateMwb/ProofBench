// Differential test: random operations run against the WASM LRUCache and against a
// simple reference LRU built on a JS Map. Any lost key, wrong eviction, wrong value
// or wrong order fails with the exact capacity and operation number.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

// Reference model. A Map iterates in insertion order, so the first key is the LRU.
class RefLRU {
  constructor(cap) { this.cap = cap; this.m = new Map(); }
  put(k, v) {
    let evicted = null;
    if (this.m.has(k)) this.m.delete(k);
    else if (this.m.size === this.cap) {
      evicted = this.m.keys().next().value;
      this.m.delete(evicted);
    }
    this.m.set(k, v);
    return evicted;
  }
  get(k) {
    if (!this.m.has(k)) return undefined;
    const v = this.m.get(k);
    this.m.delete(k);
    this.m.set(k, v);
    return v;
  }
  peek(k) { return this.m.get(k); }
  erase(k) { return this.m.delete(k); }
  orderMruFirst() { return [...this.m.entries()].reverse(); }
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function compareFull(api, ref, ctx) {
  const n = api.snapshot();
  const want = ref.orderMruFirst();
  assert.equal(n, want.length, `${ctx}: entry count`);
  for (let i = 0; i < n; i++) {
    assert.equal(api.keyAt(i), want[i][0], `${ctx}: key at position ${i}`);
    assert.equal(api.valueAt(i), want[i][1], `${ctx}: value at position ${i}`);
  }
}

export function runDifferential(api, { ops = 10000, seed = 12345 } = {}) {
  let total = 0;
  for (const cap of [1, 2, 3, 5, 8, 16, 64, 250]) {
    for (const spaceFactor of [0.5, 2, 10]) {
      const keySpace = Math.max(2, Math.round(cap * spaceFactor));
      assert.equal(api.create(cap), 1, `create(${cap})`);
      const ref = new RefLRU(cap);
      const rnd = mulberry32(seed + cap * 31 + Math.round(spaceFactor * 7));
      let hits = 0;
      let misses = 0;

      for (let i = 0; i < ops; i++, total++) {
        const ctx = `cap=${cap} keys=${keySpace} op#${i}`;
        const r = rnd();
        const k = Math.floor(rnd() * keySpace) - (keySpace >> 1); // includes negative keys
        if (r < 0.45) {
          const v = Math.floor(rnd() * 1_000_000) - 500_000;
          const ev = ref.put(k, v);
          assert.equal(api.put(k, v), ev === null ? 0 : 1, `${ctx}: put(${k}) eviction flag`);
          if (ev !== null) assert.equal(api.evictedKey(), ev, `${ctx}: put(${k}) evicted key`);
        } else if (r < 0.75) {
          const want = ref.get(k);
          const hit = api.get(k);
          if (want === undefined) {
            misses++;
            assert.equal(hit, 0, `${ctx}: get(${k}) should miss`);
          } else {
            hits++;
            assert.equal(hit, 1, `${ctx}: get(${k}) should hit (key was lost)`);
            assert.equal(api.lastValue(), want, `${ctx}: get(${k}) value`);
          }
        } else if (r < 0.85) {
          const want = ref.peek(k);
          const found = api.peek(k);
          assert.equal(found, want === undefined ? 0 : 1, `${ctx}: peek(${k}) presence`);
          if (want !== undefined) assert.equal(api.lastValue(), want, `${ctx}: peek(${k}) value`);
        } else {
          assert.equal(api.erase(k), ref.erase(k) ? 1 : 0, `${ctx}: erase(${k})`);
        }
        assert.equal(api.size(), ref.m.size, `${ctx}: size`);
        if (cap <= 8 || i % 97 === 0) compareFull(api, ref, ctx);
      }
      compareFull(api, ref, `cap=${cap} keys=${keySpace} final`);
      assert.equal(api.hits(), hits, `cap=${cap} keys=${keySpace}: hit counter`);
      assert.equal(api.misses(), misses, `cap=${cap} keys=${keySpace}: miss counter`);
    }
  }
  return total;
}

// Run against the real WASM module when executed directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { default: create_lrucache } = await import('../site/wasm/lrucache.js');
  const m = await create_lrucache();
  const w = (name, ret, args) => m.cwrap(name, ret, args);
  const api = {
    create: w('lru_create', 'number', ['number']),
    put: w('lru_put', 'number', ['number', 'number']),
    evictedKey: w('lru_evicted_key', 'number', []),
    get: w('lru_get', 'number', ['number']),
    peek: w('lru_peek', 'number', ['number']),
    lastValue: w('lru_last_value', 'number', []),
    erase: w('lru_erase', 'number', ['number']),
    snapshot: w('lru_snapshot', 'number', []),
    keyAt: w('lru_key_at', 'number', ['number']),
    valueAt: w('lru_value_at', 'number', ['number']),
    size: w('lru_size', 'number', []),
    hits: w('lru_hits', 'number', []),
    misses: w('lru_misses', 'number', []),
  };
  const n = runDifferential(api);
  console.log(`lrucache fuzz test passed (${n.toLocaleString()} operations compared with the reference model)`);
}
