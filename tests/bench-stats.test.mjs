import assert from 'node:assert/strict';
import { quantile, summarize, rangesOverlap, compare } from '../site/js/bench-stats.js';

assert.ok(Number.isNaN(quantile([], 0.5)));
assert.equal(quantile([5], 0.5), 5);
assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
assert.equal(quantile([1, 2, 3, 4, 5], 0), 1);
assert.equal(quantile([1, 2, 3, 4, 5], 1), 5);
assert.equal(quantile([0, 10], 0.25), 2.5);

const s = summarize([9, 1, 5, 3, 7]);          // input need not be sorted
assert.deepEqual([s.n, s.min, s.median, s.max], [5, 1, 5, 9]);
assert.equal(s.p25, 3);
assert.equal(s.p75, 7);

const fast = summarize([10, 10.2, 9.9, 10.1, 10]);
const slow = summarize([30, 30.5, 29.8, 30.2, 30.1]);
assert.equal(rangesOverlap(fast, slow), false);
const c = compare(fast, slow, 'A', 'B');
assert.equal(c.winner, 'A');
assert.ok(Math.abs(c.ratio - 3) < 0.05);
assert.match(c.text, /A is 3\.0\d× faster/);
assert.equal(compare(slow, fast, 'A', 'B').winner, 'B');     // order does not matter

const noisyA = summarize([10, 12, 14, 11, 13]);
const noisyB = summarize([11, 13, 12, 14, 10]);
const tie = compare(noisyA, noisyB, 'A', 'B');
assert.equal(tie.tie, true);
assert.equal(tie.winner, null);

console.log('bench-stats test passed');
