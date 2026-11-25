// Loads the built module in Node and checks it returns correct values.
import assert from 'node:assert/strict';
import create_hello from '../site/wasm/hello.js';

const m = await create_hello();
const add = m.cwrap('add', 'number', ['number', 'number']);
const fib = m.cwrap('fib', 'bigint', ['number']);
const std = m.cwrap('cpp_standard', 'number', []);

assert.equal(add(2, 3), 5);
assert.equal(add(-4, 4), 0);
assert.equal(fib(0), 0n);
assert.equal(fib(10), 55n);
assert.equal(fib(50), 12586269025n);
assert.ok(std() >= 202002, 'expected C++20 or newer');

console.log('smoke test passed');