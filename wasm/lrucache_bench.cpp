// LRUCache vs a textbook LRU (std::list + std::unordered_map), same operations,
// same keys, same compiler flags. Separate module so the demo page stays light:
// this one is only downloaded when someone runs a benchmark.
#include <emscripten/emscripten.h>

#include <CachePro/LRUCache.h>

#include "../bench/harness.hpp"
#include "../bench/std_lru.hpp"

#include <cstddef>
#include <cstdint>
#include <utility>
#include <vector>

namespace {

using Fast = CachePro::LRUCache<int, int>;

// Maps a rank (0, 1, 2, ...) to a distinct, well-spread 31-bit key. The multiplier is
// odd, so this is a bijection on 31-bit values. Without it, keys 0..N-1 would hit
// std::hash<int> (the identity) in consecutive buckets, the best case for the baseline.
inline int scramble_key(int rank) {
    return static_cast<int>((static_cast<std::uint32_t>(rank) * 0x9E3779B1U) & 0x7FFFFFFFU);
}

constexpr int kMaxCapacity = 300'000;
constexpr int kMaxOps = 5'000'000;
constexpr int kMaxSamples = 101;
constexpr int kWarmupRounds = 2;

bench::Comparison g_cmp;

// Workloads:
//   0  lookup hits   : full cache, random get() of resident keys (100% hits)
//   (keys in workloads 0 and 1 are scrambled so neither side gets sequential integers)
//   1  cache-aside   : get(); on a miss put(); Zipf keys over 10x capacity
//   2  insert+evict  : put() of fresh random keys into a full cache
// Setup (construction, prefill) is untimed; only the op loop is timed.
template <class Cache>
bench::SampleOut run_sample(int workload, const std::vector<int>& keys, std::size_t prefill,
                            int capacity, int ops) {
    Cache cache(static_cast<std::size_t>(capacity));
    std::uint64_t hits = 0;
    std::uint64_t sum = 0;
    double t0 = 0.0;
    double t1 = 0.0;
    std::uint64_t checksum = 0;

    if (workload == 0) {
        for (int i = 0; i < capacity; ++i) cache.put(scramble_key(i), i);
        t0 = bench::now_ms();
        for (int i = 0; i < ops; ++i) {
            const int* p = cache.get(keys[static_cast<std::size_t>(i)]);
            if (p != nullptr) {
                ++hits;
                sum += static_cast<std::uint32_t>(*p);
            }
        }
        t1 = bench::now_ms();
        checksum = hits * 16777216ULL + (sum & 0xFFFFFFULL);
    } else if (workload == 1) {
        for (std::size_t i = 0; i < prefill; ++i) {
            const int k = keys[i];
            if (cache.get(k) == nullptr) cache.put(k, k);
        }
        t0 = bench::now_ms();
        for (int i = 0; i < ops; ++i) {
            const int k = keys[prefill + static_cast<std::size_t>(i)];
            const int* p = cache.get(k);
            if (p != nullptr) {
                ++hits;
                sum += static_cast<std::uint32_t>(*p);
            } else {
                cache.put(k, k);
            }
        }
        t1 = bench::now_ms();
        checksum = hits * 16777216ULL + (sum & 0xFFFFFFULL);
    } else {
        for (std::size_t i = 0; i < prefill; ++i) cache.put(keys[i], static_cast<int>(i));
        t0 = bench::now_ms();
        for (int i = 0; i < ops; ++i) cache.put(keys[prefill + static_cast<std::size_t>(i)], i);
        t1 = bench::now_ms();
        checksum = static_cast<std::uint64_t>(cache.size());
    }
    return {(t1 - t0) * 1e6 / static_cast<double>(ops), checksum};
}

} // namespace

extern "C" {

// Runs `samples` recorded rounds (after warm-up) of both implementations.
// Returns the number of samples recorded, or -1 for invalid arguments.
EMSCRIPTEN_KEEPALIVE
int bench_run(int workload, int capacity, int ops, int samples, int skew_x100, int seed) {
    if (workload < 0 || workload > 2) return -1;
    if (capacity < 16 || capacity > kMaxCapacity) return -1;
    if (ops < 1000 || ops > kMaxOps) return -1;
    if (samples < 3 || samples > kMaxSamples) return -1;
    if (skew_x100 < 0 || skew_x100 > 300) return -1;

    const std::uint64_t useed = static_cast<std::uint32_t>(seed);
    std::size_t prefill = 0;
    std::vector<int> keys;
    if (workload == 0) {
        keys = bench::make_keys_uniform(static_cast<std::size_t>(ops), capacity, useed);
        for (int& k : keys) k = scramble_key(k);
    } else if (workload == 1) {
        prefill = 2 * static_cast<std::size_t>(capacity);
        keys = bench::make_keys_zipf(prefill + static_cast<std::size_t>(ops), capacity * 10,
                                     skew_x100 / 100.0, useed);
        for (int& k : keys) k = scramble_key(k);
    } else {
        prefill = static_cast<std::size_t>(capacity);
        keys = bench::make_keys_random31(prefill + static_cast<std::size_t>(ops), useed);
    }

    g_cmp.run(samples, kWarmupRounds, [&](int impl) {
        return impl == 0 ? run_sample<Fast>(workload, keys, prefill, capacity, ops)
                         : run_sample<StdLRU>(workload, keys, prefill, capacity, ops);
    });
    return samples;
}

// ns per operation of recorded sample i for implementation 0 (LRUCache) or 1 (baseline).
EMSCRIPTEN_KEEPALIVE
double bench_sample(int impl, int i) {
    if (impl < 0 || impl > 1 || i < 0) return -1.0;
    const auto& v = g_cmp.samples(impl);
    return static_cast<std::size_t>(i) < v.size() ? v[static_cast<std::size_t>(i)] : -1.0;
}

EMSCRIPTEN_KEEPALIVE
double bench_checksum(int impl) {
    return (impl < 0 || impl > 1) ? -1.0 : static_cast<double>(g_cmp.checksum(impl));
}

// 1 if both implementations produced identical results in every round.
EMSCRIPTEN_KEEPALIVE
int bench_consistent() { return g_cmp.consistent() ? 1 : 0; }

EMSCRIPTEN_KEEPALIVE
double bench_resolution_ns() { return bench::timer_resolution_ns(); }

} // extern "C"
