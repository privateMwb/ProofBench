// Pure statistics helpers for benchmark samples (ns per operation).
export function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function summarize(samples) {
  const s = [...samples].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    p25: quantile(s, 0.25),
    median: quantile(s, 0.5),
    p75: quantile(s, 0.75),
    max: s[s.length - 1],
  };
}

// True when the middle-50% ranges of two summaries overlap.
export function rangesOverlap(a, b) {
  return a.p25 <= b.p75 && b.p25 <= a.p75;
}

// Compare two summaries (lower median = faster). Overlapping middle-50% ranges
// are reported as a tie instead of declaring a winner on noise.
export function compare(a, b, nameA, nameB) {
  const faster = a.median <= b.median ? a : b;
  const slower = faster === a ? b : a;
  const fasterName = faster === a ? nameA : nameB;
  const ratio = slower.median / faster.median;
  if (rangesOverlap(a, b)) {
    return { ratio, winner: null, tie: true,
      text: `No clear winner: the middle-50% ranges of the two overlap (medians differ by ${ratio.toFixed(2)}×).` };
  }
  return { ratio, winner: fasterName, tie: false,
    text: `${fasterName} is ${ratio.toFixed(2)}× faster (median).` };
}
