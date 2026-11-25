// WASM binding for CachePro::LRUCache<int, int>.
// A small C API: one live cache instance for the interactive demo, plus a
// self-contained workload runner for the hit-rate demo. Only the library's
// public API is used; eviction is detected by peeking at leastRecentKey().
#include <emscripten/emscripten.h>

#include <CachePro/LRUCache.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <vector>

namespace {

using Cache = CachePro::LRUCache<int, int>;

constexpr int kMaxCapacity = 1'000'000;
constexpr int kMaxUniverse = 1'000'000;
constexpr int kMaxOps = 5'000'000;

std::unique_ptr<Cache> g_cache;
std::vector<int> g_keys; // snapshot of keys, most recently used first
int g_lastValue = 0;
int g_evictedKey = 0;
double g_wlHits = 0;
double g_wlMisses = 0;

// Deterministic PRNG so the same seed gives the same workload everywhere.
struct SplitMix64 {
    std::uint64_t s;
    std::uint64_t next() {
        std::uint64_t z = (s += 0x9E3779B97F4A7C15ULL);
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
        return z ^ (z >> 31);
    }
    double uniform() { return static_cast<double>(next() >> 11) * (1.0 / 9007199254740992.0); }
};

} // namespace

extern "C" {

// ---- lifecycle -------------------------------------------------------

// Returns 1 on success, 0 if capacity is out of range.
EMSCRIPTEN_KEEPALIVE
int lru_create(int capacity) {
    if (capacity <= 0 || capacity > kMaxCapacity) return 0;
    g_cache = std::make_unique<Cache>(static_cast<std::size_t>(capacity));
    g_keys.clear();
    g_lastValue = 0;
    g_evictedKey = 0;
    return 1;
}

EMSCRIPTEN_KEEPALIVE
void lru_clear() {
    if (g_cache) g_cache->clear();
    g_keys.clear();
}

// Returns 1 on success, 0 if capacity is out of range or no cache exists.
EMSCRIPTEN_KEEPALIVE
int lru_resize(int capacity) {
    if (!g_cache || capacity <= 0 || capacity > kMaxCapacity) return 0;
    g_cache->resize(static_cast<std::size_t>(capacity));
    return 1;
}

// ---- operations ------------------------------------------------------

// Returns 1 if inserting this key evicted another one (read it with
// lru_evicted_key()), otherwise 0. Updating an existing key never evicts.
EMSCRIPTEN_KEEPALIVE
int lru_put(int key, int value) {
    if (!g_cache) return 0;
    int evicted = 0;
    if (!g_cache->contains(key) && g_cache->size() == g_cache->capacity()) {
        if (const int* victim = g_cache->leastRecentKey()) {
            g_evictedKey = *victim;
            evicted = 1;
        }
    }
    g_cache->put(key, value);
    return evicted;
}

EMSCRIPTEN_KEEPALIVE
int lru_evicted_key() { return g_evictedKey; }

// Returns 1 on hit (value via lru_last_value()), 0 on miss. Refreshes recency.
EMSCRIPTEN_KEEPALIVE
int lru_get(int key) {
    if (!g_cache) return 0;
    if (const int* v = g_cache->get(key)) {
        g_lastValue = *v;
        return 1;
    }
    return 0;
}

// Same as lru_get but does not change recency or the hit/miss counters.
EMSCRIPTEN_KEEPALIVE
int lru_peek(int key) {
    if (!g_cache) return 0;
    if (const int* v = g_cache->peek(key)) {
        g_lastValue = *v;
        return 1;
    }
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lru_last_value() { return g_lastValue; }

// Returns 1 if the key was present and removed.
EMSCRIPTEN_KEEPALIVE
int lru_erase(int key) {
    if (!g_cache) return 0;
    return g_cache->erase(key) ? 1 : 0;
}

// ---- inspection ------------------------------------------------------

// Takes a snapshot of the keys (most recently used first) and returns the
// count. Read entries with lru_key_at(i) / lru_value_at(i).
EMSCRIPTEN_KEEPALIVE
int lru_snapshot() {
    g_keys.clear();
    if (g_cache) g_keys = g_cache->keys();
    return static_cast<int>(g_keys.size());
}

EMSCRIPTEN_KEEPALIVE
int lru_key_at(int i) {
    if (i < 0 || static_cast<std::size_t>(i) >= g_keys.size()) return 0;
    return g_keys[static_cast<std::size_t>(i)];
}

// Uses peek(), so reading values never disturbs recency order.
EMSCRIPTEN_KEEPALIVE
int lru_value_at(int i) {
    if (!g_cache || i < 0 || static_cast<std::size_t>(i) >= g_keys.size()) return 0;
    const int* v = g_cache->peek(g_keys[static_cast<std::size_t>(i)]);
    return v ? *v : 0;
}

EMSCRIPTEN_KEEPALIVE
int lru_size() { return g_cache ? static_cast<int>(g_cache->size()) : 0; }

EMSCRIPTEN_KEEPALIVE
int lru_capacity() { return g_cache ? static_cast<int>(g_cache->capacity()) : 0; }

EMSCRIPTEN_KEEPALIVE
double lru_hits() { return g_cache ? static_cast<double>(g_cache->hitCount()) : 0.0; }

EMSCRIPTEN_KEEPALIVE
double lru_misses() { return g_cache ? static_cast<double>(g_cache->missCount()) : 0.0; }

// Percentage, 0 to 100.
EMSCRIPTEN_KEEPALIVE
double lru_hit_rate() { return g_cache ? g_cache->hitRate() : 0.0; }

EMSCRIPTEN_KEEPALIVE
void lru_reset_stats() {
    if (g_cache) g_cache->resetStats();
}

// ---- workload runner -------------------------------------------------

// Cache-aside workload on a private cache (the interactive cache is not
// touched): sample a key from a Zipf distribution over `universe` keys,
// get(); on a miss, put(). skew_x100 = 0 is uniform, 100 is Zipf s=1.0.
// Returns the hit rate in percent, or -1 on invalid arguments. Hit and miss
// counts are available from lru_workload_hits()/lru_workload_misses().
EMSCRIPTEN_KEEPALIVE
double lru_run_workload(int capacity, int universe, int ops, int skew_x100, int seed) {
    if (capacity < 1 || capacity > kMaxCapacity) return -1.0;
    if (universe < 1 || universe > kMaxUniverse) return -1.0;
    if (ops < 1 || ops > kMaxOps) return -1.0;
    if (skew_x100 < 0 || skew_x100 > 300) return -1.0;

    const double s = skew_x100 / 100.0;
    std::vector<double> cdf(static_cast<std::size_t>(universe));
    double total = 0.0;
    for (int i = 0; i < universe; ++i) {
        total += 1.0 / std::pow(static_cast<double>(i + 1), s);
        cdf[static_cast<std::size_t>(i)] = total;
    }
    for (double& c : cdf) c /= total;

    Cache cache(static_cast<std::size_t>(capacity));
    SplitMix64 rng{static_cast<std::uint64_t>(static_cast<std::uint32_t>(seed))};

    double hits = 0, misses = 0;
    for (int n = 0; n < ops; ++n) {
        const double u = rng.uniform();
        auto it = std::lower_bound(cdf.begin(), cdf.end(), u);
        if (it == cdf.end()) --it;
        const int key = static_cast<int>(it - cdf.begin());
        if (cache.get(key) != nullptr) {
            hits += 1;
        } else {
            misses += 1;
            cache.put(key, key);
        }
    }
    g_wlHits = hits;
    g_wlMisses = misses;
    return hits / (hits + misses) * 100.0;
}

EMSCRIPTEN_KEEPALIVE
double lru_workload_hits() { return g_wlHits; }

EMSCRIPTEN_KEEPALIVE
double lru_workload_misses() { return g_wlMisses; }

} // extern "C"
