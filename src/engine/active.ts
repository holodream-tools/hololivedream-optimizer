/**
 * Overlapping Active effects take the strongest one that fires, not their sum.
 * E[max] over independent Bernoulli effects, highest value first.
 *
 * Port of app/engine/active.py::expected_maximum. Written against caller-owned
 * scratch arrays because the optimizer calls it hundreds of millions of times.
 */
const ORDER = new Int32Array(8);

export function expectedMaximum(values: Float64Array, probabilities: Float64Array, count: number): number {
  if (count === 0) return 0;
  const order = ORDER;
  for (let i = 0; i < count; i++) order[i] = i;
  // Insertion sort by value descending: `count` is at most 5.
  for (let i = 1; i < count; i++) {
    const key = order[i];
    let j = i - 1;
    while (j >= 0 && values[order[j]] < values[key]) { order[j + 1] = order[j]; j--; }
    order[j + 1] = key;
  }
  let prior = 1.0;
  let total = 0.0;
  for (let k = 0; k < count; k++) {
    const i = order[k];
    total += values[i] * probabilities[i] * prior;
    prior *= 1 - probabilities[i];
  }
  return total;
}
