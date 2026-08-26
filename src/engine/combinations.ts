/**
 * Lexicographic 5-combination indexing, matching Python's itertools.combinations.
 *
 * Workers need contiguous RANGES of the combination index rather than an
 * interleaved split, because the Top-N tie-break is
 *     sequence = combinationIndex * leaderCount + leaderIndex
 * and a worker that cannot name its global combination index cannot produce the
 * right sequence. Unranking lets each worker start anywhere.
 */

/** C(n, k) as an exact integer for the sizes this app deals with. */
export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < kk; i++) result = (result * (n - i)) / (i + 1);
  return Math.round(result);
}

/** Write the `index`-th 5-combination of `n` items into `out`. */
export function unrank(n: number, k: number, index: number, out: Int32Array): void {
  let remaining = index;
  let value = 0;
  for (let position = 0; position < k; position++) {
    for (;;) {
      const count = binomial(n - value - 1, k - position - 1);
      if (remaining < count) { out[position] = value; value++; break; }
      remaining -= count;
      value++;
    }
  }
}

/**
 * Advance `current` to the next 5-combination in lexicographic order.
 * Returns false once the last combination has been passed.
 */
export function nextCombination(current: Int32Array, n: number, k: number): boolean {
  let i = k - 1;
  while (i >= 0 && current[i] === n - k + i) i--;
  if (i < 0) return false;
  current[i]++;
  for (let j = i + 1; j < k; j++) current[j] = current[j - 1] + 1;
  return true;
}

/** Split [0, total) into `shards` contiguous ranges, largest first by remainder. */
export function shardRanges(total: number, shards: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const base = Math.floor(total / shards);
  const extra = total % shards;
  let start = 0;
  for (let i = 0; i < shards; i++) {
    const size = base + (i < extra ? 1 : 0);
    ranges.push([start, start + size]);
    start += size;
  }
  return ranges;
}
