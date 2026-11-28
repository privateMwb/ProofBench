// What LRUCache's README claims, how each claim is measured, and how the raw
// measurements are judged. The evaluate* functions are pure, so they are unit-tested.
const fmt = (n) => Number(n).toLocaleString('en-US');
const fix2 = (n) => Number(n).toFixed(2);

export const VERIFY_SIGS = {
  verify_alloc_selftest: ['number', []],
  verify_alloc_run: ['number', ['number', 'number', 'number', 'number']],
  verify_alloc_result: ['number', ['number']],
  verify_probe_run: ['number', ['number']],
  verify_probe_result: ['number', ['number']],
  verify_exc_run: ['number', ['number', 'number']],
  verify_exc_result: ['number', ['number']],
  verify_stats_run: ['number', ['number', 'number']],
  verify_stats_result: ['number', ['number']],
};

// Runs `run` then reads `count` values from `getter`, all in one worker round trip.
const group = (run, getter, count) => [run, ...Array.from({ length: count }, (_, i) => [getter, [i]])];

// ---------------------------------------------------------------- allocations
export const ALLOC_WORKLOADS = ['Insert + evict churn', 'Cache-aside (Zipf)', 'Erase + reinsert', 'Lookup hits'];
export const ALLOC_CAPACITY = 10000;
export const ALLOC_OPS = 200000;

export async function measureAlloc(w) {
  const calls = [['verify_alloc_selftest', []]];
  for (let workload = 0; workload < 4; workload++) {
    for (const impl of [0, 1]) {
      calls.push(...group(['verify_alloc_run', [impl, workload, ALLOC_CAPACITY, ALLOC_OPS]], 'verify_alloc_result', 6));
    }
  }
  const { results } = await w.batch(calls);
  const selftest = results[0];
  const rows = [];
  let at = 1;
  for (let workload = 0; workload < 4; workload++) {
    const row = { workload, ok: true };
    for (const key of ['lru', 'base']) {
      const ok = results[at] === 1;
      const v = results.slice(at + 1, at + 7);
      row[key] = { construct: v[0], warmup: v[1], steady: v[2], frees: v[3], ops: v[4], size: v[5] };
      row.ok = row.ok && ok;
      at += 7;
    }
    rows.push(row);
  }
  return { selftest, rows, capacity: ALLOC_CAPACITY };
}

export function evaluateAlloc(raw) {
  const err = (headline) => ({ status: 'error', headline, tables: [], notes: [] });
  if (raw.selftest !== 3) return err('The allocation counter failed its own self-test, so no conclusion can be drawn.');
  if (raw.rows.some((r) => !r.ok)) return err('A measurement run was rejected.');
  if (!raw.rows.some((r) => r.base.steady > 0)) return err('The counter never saw the baseline allocate, so it cannot be trusted.');

  const totalOps = raw.rows.reduce((s, r) => s + r.lru.ops, 0);
  const baseTotal = raw.rows.reduce((s, r) => s + r.base.steady, 0);
  const bad = raw.rows.find((r) => r.lru.steady !== 0 || r.lru.size !== raw.capacity);
  const table = {
    caption: `Steady state: after the cache is full and ${fmt(2 * raw.capacity)} warm-up operations. Capacity ${fmt(raw.capacity)}.`,
    columns: ['Workload', 'Operations', 'LRUCache allocations', 'std::list + unordered_map allocations', 'Baseline per operation'],
    rows: raw.rows.map((r) => [
      ALLOC_WORKLOADS[r.workload], fmt(r.lru.ops), fmt(r.lru.steady), fmt(r.base.steady), fix2(r.base.steady / r.base.ops),
    ]),
  };
  const notes = [
    `One-time cost: LRUCache made ${fmt(raw.rows[0].lru.construct)} allocations at construction (the node pool and the table) and none during warm-up. The baseline made ${fmt(raw.rows[0].base.construct)} at construction and allocates again on every insert.`,
    'Counts every call to the global operator new in this module, with all forms replaced. Allocations made directly through malloc are not counted, and resize() allocates by design, so it is not part of this check.',
  ];
  if (bad) {
    return { status: 'fail', tables: [table], notes,
      headline: `LRUCache allocated ${fmt(bad.lru.steady)} times in steady state during "${ALLOC_WORKLOADS[bad.workload]}".` };
  }
  return { status: 'pass', tables: [table], notes,
    headline: `0 heap allocations across ${fmt(totalOps)} steady-state operations in 4 workloads. The baseline made ${fmt(baseTotal)}.` };
}

// ---------------------------------------------------------------- O(1)
export const PROBE_CAPACITIES = [100, 1000, 10000, 100000, 300000];
export const PROBE_OPS = ['get (hit)', 'get (miss)', 'erase', 'put (room)', 'put (evicts)'];

export async function measureProbe(w) {
  const calls = [];
  for (const capacity of PROBE_CAPACITIES) calls.push(...group(['verify_probe_run', [capacity]], 'verify_probe_result', 10));
  const { results } = await w.batch(calls);
  const rows = PROBE_CAPACITIES.map((capacity, i) => {
    const base = i * 11;
    return { capacity, ok: results[base] === 1, eq: results.slice(base + 1, base + 6), hash: results.slice(base + 6, base + 11) };
  });
  return { rows };
}

export function evaluateProbe(raw) {
  if (raw.rows.some((r) => !r.ok)) return { status: 'error', headline: 'A measurement run was rejected.', tables: [], notes: [] };
  // O(log n) would grow ~2.7x over this range of sizes, O(n) ~3000x. Allow 1.5x plus a quarter comparison.
  const growth = PROBE_OPS.map((name, j) => {
    const v = raw.rows.map((r) => r.eq[j]);
    const lo = Math.min(...v), hi = Math.max(...v);
    return { name, lo, hi, flat: hi <= 1.5 * lo + 0.25, small: hi <= 4 };
  });
  const maxEq = Math.max(...growth.map((g) => g.hi));
  const hashes = raw.rows.flatMap((r) => r.hash);
  const maxHash = Math.max(...hashes), minHash = Math.min(...hashes);
  const first = raw.rows[0].capacity, last = raw.rows[raw.rows.length - 1].capacity;
  const table = {
    caption: 'Average key comparisons per operation, then hash calls per operation (20,000 operations of each kind per capacity).',
    columns: ['Capacity', ...PROBE_OPS, 'Hash calls per op (range)'],
    rows: raw.rows.map((r) => [fmt(r.capacity), ...r.eq.map(fix2),
      Math.min(...r.hash) === Math.max(...r.hash) ? fix2(r.hash[0]) : `${fix2(Math.min(...r.hash))} – ${fix2(Math.max(...r.hash))}`]),
  };
  const notes = [
    `Work is counted through a custom Hash and KeyEqual that tally their calls. An O(log n) structure would grow about 2.7× between ${fmt(first)} and ${fmt(last)} entries, and a linear scan about ${fmt(Math.round(last / first))}×.`,
    'Slots that are skipped by comparing a stored hash are not visible to this counter, so it measures the expensive work (hashing and full key comparisons), not every memory probe. Wall-clock time per operation does rise at large sizes in the benchmark above, which is the memory hierarchy, not extra work per operation.',
  ];
  const bad = growth.find((g) => !g.flat || !g.small);
  if (bad) {
    return { status: 'fail', tables: [table], notes,
      headline: `${bad.name}: key comparisons per operation grew from ${fix2(bad.lo)} to ${fix2(bad.hi)} as the cache grew.` };
  }
  const oneHash = Math.abs(maxHash - 1) < 1e-9 && Math.abs(minHash - 1) < 1e-9;
  return { status: 'pass', tables: [table], notes,
    headline: `Work per operation is flat from ${fmt(first)} to ${fmt(last)} entries: at most ${fix2(maxEq)} key comparisons per operation` +
      (oneHash ? ', and exactly one hash call per operation, even for puts that evict.' : `, and ${fix2(maxHash)} hash calls at most.`) };
}

// ---------------------------------------------------------------- exceptions
export const EXC_CAPACITY = 4;
const EXC_OPS = ['put', 'emplace'];

export async function measureExc(w) {
  const calls = [];
  const combos = [];
  for (let op = 0; op < 2; op++) {
    for (let fill = 0; fill <= EXC_CAPACITY; fill++) {
      combos.push({ op, fill });
      calls.push(...group(['verify_exc_run', [fill, op]], 'verify_exc_result', 7));
    }
  }
  const { results } = await w.batch(calls);
  const rows = combos.map(({ op, fill }, i) => {
    const b = i * 8;
    const v = results.slice(b + 1, b + 8);
    return { op: EXC_OPS[op], fill, ok: results[b] === 1, points: v[0], unchanged: v[1], changed: v[2],
      sizeBefore: v[3], sizeAfter: v[4], lostKey: v[5], usable: v[6] };
  });
  return { rows, capacity: EXC_CAPACITY };
}

export function evaluateExc(raw) {
  if (raw.rows.some((r) => !r.ok || r.points === 0)) {
    return { status: 'error', tables: [], notes: [],
      headline: 'The throw injection did not reach any throw point, so no conclusion can be drawn.' };
  }
  const isFull = (r) => r.fill === raw.capacity;
  const good = (r) => r.changed === 0 && r.usable === r.points;
  const roomOk = raw.rows.filter((r) => !isFull(r)).every(good);
  const fullOk = raw.rows.filter(isFull).every(good);
  const failing = raw.rows.find((r) => isFull(r) && !good(r));
  const table = {
    caption: `A cache of capacity ${raw.capacity} receives a new key. A throw is injected into every constructor call the operation makes.`,
    columns: ['Operation', 'Entries before', 'Throw points tried', 'Cache unchanged after the throw?'],
    rows: raw.rows.map((r) => [
      `${r.op}()`, `${r.fill} of ${raw.capacity}${isFull(r) ? ' (full, must evict)' : ''}`, String(r.points),
      good(r) ? 'Yes' : `No: ${r.sizeBefore} entries became ${r.sizeAfter}${r.lostKey >= 0 ? `, key ${r.lostKey} lost` : ''}`,
    ]),
  };
  const notes = ['The least-recently-used key is the one lost in the failing case. A throw during the constructor of the value is the injected failure; the cache is still usable afterwards.'];
  if (roomOk && fullOk) {
    return { status: 'pass', tables: [table], notes, headline: `Every injected throw left the cache exactly as it was, with room and when evicting.` };
  }
  if (roomOk) {
    return { status: 'partial', tables: [table], notes,
      headline: `Holds while the cache has room. Fails when the insert has to evict: ${failing.sizeBefore} entries became ${failing.sizeAfter}` +
        (failing.lostKey >= 0 ? ` and key ${failing.lostKey} (least recently used) was lost.` : '.') };
  }
  return { status: 'fail', tables: [table], notes, headline: 'A throwing constructor changed the cache even though it had room.' };
}

// ---------------------------------------------------------------- statistics
export const STATS_CAPACITY = 1000;
export const STATS_OPS = 200000;

export async function measureStats(w) {
  const { results } = await w.batch(group(['verify_stats_run', [STATS_CAPACITY, STATS_OPS]], 'verify_stats_result', 9));
  return { ok: results[0] === 1, v: results.slice(1) };
}

export function evaluateStats(raw) {
  if (!raw.ok) return { status: 'error', headline: 'The measurement run was rejected.', tables: [], notes: [] };
  const [hits, misses, rHits, rMisses, rate, rRate, disagree, peekMoved, afterReset] = raw.v;
  const table = {
    caption: `${fmt(STATS_OPS)} random cache-aside operations at capacity ${fmt(STATS_CAPACITY)}, run in lockstep on LRUCache and an independent reference LRU.`,
    columns: ['', 'LRUCache', 'Reference'],
    rows: [['Hits', fmt(hits), fmt(rHits)], ['Misses', fmt(misses), fmt(rMisses)],
      ['Hit rate', `${rate.toFixed(3)}%`, `${rRate.toFixed(3)}%`]],
  };
  const notes = [
    `Operations where LRUCache and the reference disagreed about a hit: ${fmt(disagree)}. Peeks or contains() calls that moved a counter: ${fmt(peekMoved)}. Hits plus misses after resetStats(): ${fmt(afterReset)}.`,
  ];
  const problems = [];
  if (hits !== rHits || misses !== rMisses) problems.push('counts differ from the reference');
  if (Math.abs(rate - rRate) > 1e-9) problems.push('hit rate differs');
  if (disagree !== 0) problems.push('hit/miss decisions differ');
  if (peekMoved !== 0) problems.push('peek moved a counter');
  if (afterReset !== 0) problems.push('resetStats() did not reset');
  if (problems.length) return { status: 'fail', tables: [table], notes, headline: `Not verified: ${problems.join('; ')}.` };
  return { status: 'pass', tables: [table], notes,
    headline: `Hit and miss counts match the reference exactly (${fmt(hits)} hits, ${fmt(misses)} misses), peeks never touch them, and resetStats() clears them.` };
}

// ---------------------------------------------------------------- the claims
export const CLAIMS = [
  { id: 'allocations', quote: 'Pool-allocated list and flat open-addressing table, so steady-state use makes zero heap allocations',
    title: 'Zero heap allocations in steady state',
    how: 'Every global operator new and delete is replaced with a counting version. Four workloads run until the cache is full and warm, then the allocation counter is read before and after a long run. The same workloads run on a std::list + std::unordered_map baseline to prove the counter can see allocations.',
    run: async (w) => evaluateAlloc(await measureAlloc(w)) },
  { id: 'complexity', quote: 'Header-only fixed-capacity LRU cache with O(1) get, put and erase',
    title: 'O(1) get, put and erase',
    how: 'The cache is built with a Hash and KeyEqual that count their calls. After filling it at five sizes from 100 to 300,000 entries, the average hash calls and key comparisons per operation are measured for lookups that hit and miss, erases, inserts with room, and inserts that evict. Growth in that work would show the operation is not constant time.',
    run: async (w) => evaluateProbe(await measureProbe(w)) },
  { id: 'exceptions', quote: 'Strong exception guarantee on insert',
    title: 'Strong exception guarantee on insert',
    how: 'A value type throws from its constructor on demand. A throw is injected at every constructor call that put() and emplace() make, into a cache that has room and into one that is full, and the cache is compared before and after: same size, same keys, same order, same values. This module is built with C++ exceptions enabled.',
    run: async (w) => evaluateExc(await measureExc(w)) },
  { id: 'statistics', quote: 'built-in hit and miss statistics',
    title: 'Hit and miss statistics are correct',
    how: 'A random workload runs on LRUCache and, in lockstep, on an independent reference LRU. The two must agree on every hit and miss, the totals and hit rate must match, peek and contains must not change the counters, and resetStats() must zero them.',
    run: async (w) => evaluateStats(await measureStats(w)) },
];
