// Reusable benchmark harness: timer, deterministic key generators, and an
// interleaved A/B runner. Header-only; used by every wasm/<lib>_bench.cpp.
#pragma once

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#endif

namespace bench {

// Milliseconds from a monotonic clock. In the browser this is performance.now(),
// whose resolution is deliberately coarse, so each timed sample must run long.
inline double now_ms() {
#ifdef __EMSCRIPTEN__
    return emscripten_get_now();
#else
    using clk = std::chrono::steady_clock;
    return std::chrono::duration<double, std::milli>(clk::now().time_since_epoch()).count();
#endif
}

// Smallest observed step of the clock, in nanoseconds (spins for at most ~50 ms).
inline double timer_resolution_ns() {
    double best = 1e18;
    double prev = now_ms();
    const double deadline = prev + 50.0;
    int steps = 0;
    while (steps < 20) {
        const double t = now_ms();
        if (t > prev) {
            best = std::min(best, t - prev);
            prev = t;
            ++steps;
        }
        if (t > deadline) break;
    }
    return best >= 1e17 ? 0.0 : best * 1e6;
}

// Deterministic PRNG: same seed, same sequence, on every platform.
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

inline std::vector<int> make_keys_uniform(std::size_t n, int universe, std::uint64_t seed) {
    SplitMix64 rng{seed};
    std::vector<int> keys(n);
    for (auto& k : keys) k = static_cast<int>(rng.next() % static_cast<std::uint64_t>(universe));
    return keys;
}

// Zipf-distributed keys over [0, universe); skew 0 is uniform.
inline std::vector<int> make_keys_zipf(std::size_t n, int universe, double skew, std::uint64_t seed) {
    if (skew <= 0.0) return make_keys_uniform(n, universe, seed);
    std::vector<double> cdf(static_cast<std::size_t>(universe));
    double total = 0.0;
    for (int i = 0; i < universe; ++i) {
        total += 1.0 / std::pow(static_cast<double>(i + 1), skew);
        cdf[static_cast<std::size_t>(i)] = total;
    }
    for (double& c : cdf) c /= total;
    SplitMix64 rng{seed};
    std::vector<int> keys(n);
    for (auto& k : keys) {
        auto it = std::lower_bound(cdf.begin(), cdf.end(), rng.uniform());
        if (it == cdf.end()) --it;
        k = static_cast<int>(it - cdf.begin());
    }
    return keys;
}

// Random non-negative 31-bit keys (almost always distinct).
inline std::vector<int> make_keys_random31(std::size_t n, std::uint64_t seed) {
    SplitMix64 rng{seed};
    std::vector<int> keys(n);
    for (auto& k : keys) k = static_cast<int>(rng.next() & 0x7FFFFFFFULL);
    return keys;
}

struct SampleOut {
    double ns_per_op;
    std::uint64_t checksum;
};

// Runs two implementations (0 and 1) on identical input. Rounds alternate order
// (0,1 then 1,0 ...) so drift and cache warmth do not favour either one. Warm-up
// rounds are executed but not recorded. Every checksum must match across both
// implementations and all rounds, otherwise `consistent()` is false.
class Comparison {
  public:
    void run(int samples, int warmup, const std::function<SampleOut(int)>& one) {
        clear();
        for (int round = 0; round < warmup + samples; ++round) {
            for (int j = 0; j < 2; ++j) {
                const int impl = (round % 2 == 0) ? j : 1 - j;
                const SampleOut r = one(impl);
                if (!have_ref_) {
                    ref_ = r.checksum;
                    have_ref_ = true;
                } else if (r.checksum != ref_) {
                    consistent_ = false;
                }
                checksum_[impl] = r.checksum;
                if (round >= warmup) ns_[impl].push_back(r.ns_per_op);
            }
        }
    }
    void clear() {
        ns_[0].clear();
        ns_[1].clear();
        checksum_[0] = checksum_[1] = ref_ = 0;
        have_ref_ = false;
        consistent_ = true;
    }
    const std::vector<double>& samples(int impl) const { return ns_[impl]; }
    std::uint64_t checksum(int impl) const { return checksum_[impl]; }
    bool consistent() const { return consistent_ && checksum_[0] == checksum_[1]; }

  private:
    std::vector<double> ns_[2];
    std::uint64_t checksum_[2] = {0, 0};
    std::uint64_t ref_ = 0;
    bool have_ref_ = false;
    bool consistent_ = true;
};

} // namespace bench
