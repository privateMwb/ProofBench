// Verification module for LRUCache's README claims. Built with C++ exceptions enabled
// (needed to inject throwing constructors) and with every global operator new/delete
// replaced by a counting version (needed to count heap allocations).
//
// Checks, each returning raw measurements for the page to judge:
//   alloc  : heap allocations at construction / warm-up / steady state, vs a baseline
//   probe  : hash calls and key comparisons per operation as capacity grows (O(1))
//   exc    : throw injection at every constructor call made by put()/emplace()
//   stats  : hit/miss counters vs an independent reference implementation
#include <emscripten/emscripten.h>

#include <CachePro/LRUCache.h>

#include "../bench/harness.hpp"
#include "../bench/std_lru.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <functional>
#include <new>
#include <utility>
#include <vector>

// ======================================================================
//  Allocation counting: replace the complete set of global new/delete.
//  (All forms are defined so none of the library's own versions get linked.)
// ======================================================================
namespace {
std::uint64_t g_allocs = 0;
std::uint64_t g_frees = 0;

void* alloc_plain(std::size_t n) {
    void* p = std::malloc(n != 0 ? n : 1);
    if (p == nullptr) throw std::bad_alloc();
    ++g_allocs;
    return p;
}
void* alloc_plain_nothrow(std::size_t n) noexcept {
    void* p = std::malloc(n != 0 ? n : 1);
    if (p != nullptr) ++g_allocs;
    return p;
}
void* alloc_aligned_nothrow(std::size_t n, std::size_t a) noexcept {
    if (a < sizeof(void*)) a = sizeof(void*);
    void* p = nullptr;
    if (posix_memalign(&p, a, n != 0 ? n : 1) != 0) return nullptr;
    ++g_allocs;
    return p;
}
void* alloc_aligned(std::size_t n, std::size_t a) {
    void* p = alloc_aligned_nothrow(n, a);
    if (p == nullptr) throw std::bad_alloc();
    return p;
}
void release(void* p) noexcept {
    if (p != nullptr) {
        ++g_frees;
        std::free(p);
    }
}
} // namespace

void* operator new(std::size_t n) { return alloc_plain(n); }
void* operator new[](std::size_t n) { return alloc_plain(n); }
void* operator new(std::size_t n, const std::nothrow_t&) noexcept { return alloc_plain_nothrow(n); }
void* operator new[](std::size_t n, const std::nothrow_t&) noexcept { return alloc_plain_nothrow(n); }
void* operator new(std::size_t n, std::align_val_t a) { return alloc_aligned(n, static_cast<std::size_t>(a)); }
void* operator new[](std::size_t n, std::align_val_t a) { return alloc_aligned(n, static_cast<std::size_t>(a)); }
void* operator new(std::size_t n, std::align_val_t a, const std::nothrow_t&) noexcept {
    return alloc_aligned_nothrow(n, static_cast<std::size_t>(a));
}
void* operator new[](std::size_t n, std::align_val_t a, const std::nothrow_t&) noexcept {
    return alloc_aligned_nothrow(n, static_cast<std::size_t>(a));
}
void operator delete(void* p) noexcept { release(p); }
void operator delete[](void* p) noexcept { release(p); }
void operator delete(void* p, std::size_t) noexcept { release(p); }
void operator delete[](void* p, std::size_t) noexcept { release(p); }
void operator delete(void* p, const std::nothrow_t&) noexcept { release(p); }
void operator delete[](void* p, const std::nothrow_t&) noexcept { release(p); }
void operator delete(void* p, std::align_val_t) noexcept { release(p); }
void operator delete[](void* p, std::align_val_t) noexcept { release(p); }
void operator delete(void* p, std::size_t, std::align_val_t) noexcept { release(p); }
void operator delete[](void* p, std::size_t, std::align_val_t) noexcept { release(p); }
void operator delete(void* p, std::align_val_t, const std::nothrow_t&) noexcept { release(p); }
void operator delete[](void* p, std::align_val_t, const std::nothrow_t&) noexcept { release(p); }

namespace {

using Fast = CachePro::LRUCache<int, int>;

// Same scrambling as the benchmark: distinct, well-spread 31-bit keys.
inline int scramble_key(int rank) {
    return static_cast<int>((static_cast<std::uint32_t>(rank) * 0x9E3779B1U) & 0x7FFFFFFFU);
}

// ======================================================================
//  alloc
// ======================================================================
double g_alloc_res[8] = {};

// workload 0: insert+evict churn   1: cache-aside (Zipf)   2: erase+reinsert   3: lookup hits
template <class Cache>
void alloc_run(int workload, int capacity, int ops) {
    const std::size_t cap = static_cast<std::size_t>(capacity);
    const std::size_t warm = 2 * cap;
    const std::size_t total = warm + static_cast<std::size_t>(ops);

    // All input data is prepared before any counter is read.
    std::vector<int> keys;
    std::vector<int> resident(cap);
    for (std::size_t i = 0; i < cap; ++i) resident[i] = scramble_key(static_cast<int>(i));
    if (workload == 0) {
        keys = bench::make_keys_random31(total, 7);
    } else if (workload == 1) {
        keys = bench::make_keys_zipf(total, capacity * 10, 1.0, 7);
        for (int& k : keys) k = scramble_key(k);
    } else {
        keys = bench::make_keys_uniform(total, capacity, 7); // indices into `resident`
    }

    std::uint64_t sink = 0;
    auto step = [&](Cache& c, std::size_t i) {
        if (workload == 0) {
            c.put(keys[i], static_cast<int>(i));
        } else if (workload == 1) {
            const int k = keys[i];
            if (c.get(k) == nullptr) c.put(k, k);
        } else if (workload == 2) {
            const int k = resident[static_cast<std::size_t>(keys[i])];
            (void)c.erase(k);
            c.put(k, static_cast<int>(i));
        } else {
            const int* p = c.get(resident[static_cast<std::size_t>(keys[i])]);
            if (p != nullptr) sink += static_cast<std::uint32_t>(*p);
        }
    };

    const std::uint64_t a0 = g_allocs;
    Cache cache(cap);
    const std::uint64_t a1 = g_allocs;

    if (workload >= 2) {
        for (std::size_t i = 0; i < cap; ++i) cache.put(resident[i], static_cast<int>(i));
    }
    for (std::size_t i = 0; i < warm; ++i) step(cache, i);
    const std::uint64_t a2 = g_allocs;
    const std::uint64_t f2 = g_frees;

    for (std::size_t i = warm; i < total; ++i) step(cache, i);
    const std::uint64_t a3 = g_allocs;
    const std::uint64_t f3 = g_frees;

    g_alloc_res[0] = static_cast<double>(a1 - a0);       // construction
    g_alloc_res[1] = static_cast<double>(a2 - a1);       // prefill + warm-up
    g_alloc_res[2] = static_cast<double>(a3 - a2);       // steady state
    g_alloc_res[3] = static_cast<double>(f3 - f2);       // frees in steady state
    g_alloc_res[4] = static_cast<double>(ops);
    g_alloc_res[5] = static_cast<double>(cache.size());  // must equal capacity
    g_alloc_res[6] = static_cast<double>(sink & 0xFFFFFF);
}

// ======================================================================
//  probe: hash calls and key comparisons per operation
// ======================================================================
std::uint64_t g_hashCalls = 0;
std::uint64_t g_eqCalls = 0;
struct CountHash {
    std::size_t operator()(int k) const noexcept {
        ++g_hashCalls;
        return std::hash<int>{}(k);
    }
};
struct CountEq {
    bool operator()(int a, int b) const noexcept {
        ++g_eqCalls;
        return a == b;
    }
};
using Probed = CachePro::LRUCache<int, int, CountHash, CountEq>;
double g_probe_res[10] = {};

// ======================================================================
//  exc: throw injection
// ======================================================================
struct Boom {};
struct Faulty {
    int v;
    static inline int countdown = -1; // throws when a constructor call finds it at 0
    static void tick() {
        if (countdown >= 0 && countdown-- == 0) throw Boom{};
    }
    explicit Faulty(int x) : v(x) { tick(); }
    Faulty(const Faulty& o) : v(o.v) { tick(); }
    Faulty(Faulty&& o) noexcept(false) : v(o.v) { tick(); }
    Faulty& operator=(const Faulty&) = default;
    Faulty& operator=(Faulty&&) = default;
};
using FCache = CachePro::LRUCache<int, Faulty>;
double g_exc_res[8] = {};

std::vector<std::pair<int, int>> snapshot(FCache& c) {
    std::vector<std::pair<int, int>> out;
    for (int k : c.keys()) out.emplace_back(k, c.peek(k)->v);
    return out;
}

// ======================================================================
//  stats
// ======================================================================
double g_stats_res[10] = {};

} // namespace

extern "C" {

// ---- alloc -----------------------------------------------------------

// Sanity check of the counter itself: returns 3 if three allocations and three frees were
// observed, otherwise -1. Each pointer is stored to a volatile first: without that, an
// optimizing compiler (clang at -O1 and up) is allowed to delete a matched new/delete pair,
// and the counter would never see it.
EMSCRIPTEN_KEEPALIVE
double verify_alloc_selftest() {
    static void* volatile sink = nullptr;
    const std::uint64_t a0 = g_allocs;
    const std::uint64_t f0 = g_frees;
    int* a = new int(1);
    sink = a;
    int* b = new int[4];
    sink = b;
    int* c = new (std::nothrow) int(3);
    sink = c;
    (void)sink; // the volatile store is the point; nothing needs to read it back
    const std::uint64_t made = g_allocs - a0;
    delete a;
    delete[] b;
    delete c;
    return (made == 3 && g_frees - f0 == 3) ? 3.0 : -1.0;
}

// impl 0 = LRUCache, 1 = std::list + unordered_map baseline. Returns 1 on success.
EMSCRIPTEN_KEEPALIVE
int verify_alloc_run(int impl, int workload, int capacity, int ops) {
    if (impl < 0 || impl > 1 || workload < 0 || workload > 3) return 0;
    if (capacity < 16 || capacity > 300000 || ops < 1000 || ops > 2000000) return 0;
    for (double& v : g_alloc_res) v = 0.0;
    if (impl == 0) alloc_run<Fast>(workload, capacity, ops);
    else alloc_run<StdLRU>(workload, capacity, ops);
    return 1;
}

// 0 construction allocs, 1 warm-up allocs, 2 steady-state allocs, 3 steady-state frees,
// 4 steady-state operations, 5 final size (should equal capacity)
EMSCRIPTEN_KEEPALIVE
double verify_alloc_result(int i) { return (i >= 0 && i < 8) ? g_alloc_res[i] : -1.0; }

// ---- probe -----------------------------------------------------------

constexpr int kProbeOps = 20000;

// Fills a cache of `capacity` entries, then measures average hash calls and key
// comparisons per operation. Returns 1 on success.
EMSCRIPTEN_KEEPALIVE
int verify_probe_run(int capacity) {
    if (capacity < 16 || capacity > 300000) return 0;
    const int cap = capacity;
    Probed c(static_cast<std::size_t>(cap));
    for (int i = 0; i < cap; ++i) c.put(scramble_key(i), i);

    bench::SplitMix64 rng{12345};
    double eq[5] = {}, hs[5] = {};
    auto account = [&](int slot, std::uint64_t h0, std::uint64_t e0) {
        hs[slot] += static_cast<double>(g_hashCalls - h0);
        eq[slot] += static_cast<double>(g_eqCalls - e0);
    };

    for (int j = 0; j < kProbeOps; ++j) { // slot 0: get, key present
        const int k = scramble_key(static_cast<int>(rng.next() % static_cast<std::uint64_t>(cap)));
        const std::uint64_t h0 = g_hashCalls, e0 = g_eqCalls;
        (void)c.get(k);
        account(0, h0, e0);
    }
    for (int j = 0; j < kProbeOps; ++j) { // slot 1: get, key absent
        const int k = scramble_key(cap + static_cast<int>(rng.next() % static_cast<std::uint64_t>(cap)));
        const std::uint64_t h0 = g_hashCalls, e0 = g_eqCalls;
        (void)c.get(k);
        account(1, h0, e0);
    }
    for (int j = 0; j < kProbeOps; ++j) { // slot 2: erase; slot 3: put with room
        const int k = scramble_key(j % cap);
        std::uint64_t h0 = g_hashCalls, e0 = g_eqCalls;
        (void)c.erase(k);
        account(2, h0, e0);
        h0 = g_hashCalls;
        e0 = g_eqCalls;
        c.put(k, j);
        account(3, h0, e0);
    }
    for (int j = 0; j < kProbeOps; ++j) { // slot 4: put of a new key into a full cache (evicts)
        const std::uint64_t h0 = g_hashCalls, e0 = g_eqCalls;
        c.put(scramble_key(2 * cap + j), j);
        account(4, h0, e0);
    }
    for (int s = 0; s < 5; ++s) {
        g_probe_res[s] = eq[s] / kProbeOps;
        g_probe_res[5 + s] = hs[s] / kProbeOps;
    }
    return 1;
}

// 0..4: key comparisons per op for [get hit, get miss, erase, put (room), put (evicts)]
// 5..9: hash calls per op, same order
EMSCRIPTEN_KEEPALIVE
double verify_probe_result(int i) { return (i >= 0 && i < 10) ? g_probe_res[i] : -1.0; }

// ---- exc -------------------------------------------------------------

// Capacity-4 cache holding `fill` entries (0..4) receives one new key via put()
// (op 0, copying a value) or emplace() (op 1). A throw is injected at every
// constructor call the operation makes, one point per attempt, until an attempt
// succeeds. After each throw the cache must be exactly as before.
EMSCRIPTEN_KEEPALIVE
int verify_exc_run(int fill, int op) {
    if (fill < 0 || fill > 4 || op < 0 || op > 1) return 0;
    for (double& v : g_exc_res) v = 0.0;
    g_exc_res[5] = -1.0;
    int thrown = 0, unchanged = 0, changed = 0, usable = 0;
    int firstBefore = -1, firstAfter = -1;
    bool haveFirst = false;

    for (int point = 0; point < 16; ++point) {
        Faulty::countdown = -1;
        FCache c(4);
        for (int k = 1; k <= fill; ++k) c.put(k, Faulty(10 * k));
        if (fill >= 2) (void)c.get(1); // make recency order non-trivial
        const auto before = snapshot(c);
        const Faulty arg(900);

        Faulty::countdown = point;
        bool threw = false;
        try {
            if (op == 0) c.put(99, arg);
            else c.emplace(99, 900);
        } catch (const Boom&) {
            threw = true;
        }
        Faulty::countdown = -1;
        if (!threw) break; // every throw point has been covered

        ++thrown;
        const auto after = snapshot(c);
        if (after == before) {
            ++unchanged;
        } else {
            ++changed;
            if (!haveFirst) {
                haveFirst = true;
                firstBefore = static_cast<int>(before.size());
                firstAfter = static_cast<int>(after.size());
                for (const auto& e : before) {
                    if (c.peek(e.first) == nullptr) {
                        g_exc_res[5] = e.first; // a key that vanished
                        break;
                    }
                }
            }
        }
        c.put(100, Faulty(1000)); // the cache must still work afterwards
        if (c.peek(100) != nullptr) ++usable;
    }
    g_exc_res[0] = thrown;
    g_exc_res[1] = unchanged;
    g_exc_res[2] = changed;
    g_exc_res[3] = firstBefore;
    g_exc_res[4] = firstAfter;
    g_exc_res[6] = usable;
    return 1;
}

// 0 throw points exercised, 1 left unchanged, 2 changed, 3 size before (first change),
// 4 size after (first change), 5 key that vanished (-1 none), 6 still usable afterwards
EMSCRIPTEN_KEEPALIVE
double verify_exc_result(int i) { return (i >= 0 && i < 8) ? g_exc_res[i] : -1.0; }

// ---- stats -----------------------------------------------------------

// Runs a random cache-aside workload on LRUCache and on the baseline in lockstep.
EMSCRIPTEN_KEEPALIVE
int verify_stats_run(int capacity, int ops) {
    if (capacity < 16 || capacity > 100000 || ops < 1000 || ops > 2000000) return 0;
    for (double& v : g_stats_res) v = 0.0;
    Fast c(static_cast<std::size_t>(capacity));
    StdLRU ref(static_cast<std::size_t>(capacity));
    const auto keys = bench::make_keys_uniform(static_cast<std::size_t>(ops), capacity * 3, 99);

    double refHits = 0, refMisses = 0, disagreements = 0, peekMoved = 0;
    for (int i = 0; i < ops; ++i) {
        const int k = scramble_key(keys[static_cast<std::size_t>(i)]);
        const bool hitC = c.get(k) != nullptr;
        const bool hitR = ref.get(k) != nullptr;
        if (hitC != hitR) ++disagreements;
        if (hitR) ++refHits; else { ++refMisses; c.put(k, i); ref.put(k, i); }
        if (i % 7 == 0) { // peek/contains must not touch the counters
            const std::size_t h = c.hitCount(), m = c.missCount();
            (void)c.peek(k);
            (void)c.contains(k + 1);
            if (c.hitCount() != h || c.missCount() != m) ++peekMoved;
        }
    }
    g_stats_res[0] = static_cast<double>(c.hitCount());
    g_stats_res[1] = static_cast<double>(c.missCount());
    g_stats_res[2] = refHits;
    g_stats_res[3] = refMisses;
    g_stats_res[4] = c.hitRate();
    g_stats_res[5] = refHits / (refHits + refMisses) * 100.0;
    g_stats_res[6] = disagreements;
    g_stats_res[7] = peekMoved;
    c.resetStats();
    g_stats_res[8] = static_cast<double>(c.hitCount() + c.missCount());
    return 1;
}

// 0/1 library hits/misses, 2/3 reference hits/misses, 4 library hit rate %, 5 reference hit
// rate %, 6 operations where library and reference disagreed, 7 peeks that moved a counter,
// 8 hits+misses after resetStats() (should be 0)
EMSCRIPTEN_KEEPALIVE
double verify_stats_result(int i) { return (i >= 0 && i < 10) ? g_stats_res[i] : -1.0; }

} // extern "C"
