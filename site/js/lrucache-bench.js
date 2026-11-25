import { initBenchPanel } from './bench-panel.js';

initBenchPanel(document.getElementById('bench-root'), {
  moduleUrl: new URL('../wasm/lrucache_bench.js', import.meta.url),
  labels: ['LRUCache', 'std::list + unordered_map'],
  baselineNote:
    'The baseline is the textbook design: a std::list for recency order plus a std::unordered_map from key to list node. It is given reserve(capacity) up front so it never rehashes, which is its best case.',
  workloads: [
    { label: 'Lookup hits',
      desc: 'Random get() on a full cache where every key is present (100% hit rate). Measures lookup plus move-to-front.' },
    { label: 'Cache-aside, Zipf traffic',
      desc: 'get(), then put() on a miss, over 10× as many keys as fit, with Zipf skew 1.0. A realistic mix of hits, misses and evictions.' },
    { label: 'Insert + evict',
      desc: 'put() of new random keys into a full cache, so every call evicts one entry. This is the allocation-heavy path.' },
  ],
  capacities: [1000, 10000, 100000],
  opsChoices: [100000, 500000, 1000000],
  sweepCapacities: [1000, 4000, 16000, 64000, 256000],
});
