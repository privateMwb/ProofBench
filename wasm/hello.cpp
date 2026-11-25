// Phase 1 smoke-test module: proves C++ -> WASM -> browser works.
#include <emscripten/emscripten.h>
#include <cstdint>

extern "C" {

EMSCRIPTEN_KEEPALIVE
int add(int a, int b) { return a + b; }

EMSCRIPTEN_KEEPALIVE
std::uint64_t fib(int n) {
    std::uint64_t a = 0, b = 1;
    for (int i = 0; i < n; ++i) { auto t = a + b; a = b; b = t; }
    return a;
}

EMSCRIPTEN_KEEPALIVE
long cpp_standard() { return static_cast<long>(__cplusplus); }

}