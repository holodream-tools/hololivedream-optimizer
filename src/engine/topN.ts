/**
 * Bounded Top-N, ranked by (value, -sequence).
 *
 * Port of optimizer_fast._add_top. The `-sequence` second key keeps the EARLIEST
 * enumerated entry when scores tie, which is what makes the result independent of
 * how the work was sharded. Exact ties are common -- around 21% of scores in real
 * data -- so this is not a theoretical concern.
 */

export interface TopEntry {
  value: number;
  sequence: number;
  members: Int32Array;   // owned copy
  leaderIndex: number;
}

/** True when a ranks strictly below b under (value, -sequence). */
function below(a: TopEntry, b: TopEntry): boolean {
  if (a.value !== b.value) return a.value < b.value;
  return -a.sequence < -b.sequence;
}

export class TopN {
  readonly limit: number;
  private heap: TopEntry[] = [];

  constructor(limit: number) { this.limit = limit; }

  get size(): number { return this.heap.length; }

  /** Worst entry currently kept, or undefined while the heap is not yet full. */
  private get worst(): TopEntry | undefined { return this.heap[0]; }

  add(value: number, sequence: number, members: ArrayLike<number>, leaderIndex: number): void {
    if (this.heap.length >= this.limit) {
      const worst = this.worst!;
      if (!(value > worst.value || (value === worst.value && -sequence > -worst.sequence))) return;
    }
    const entry: TopEntry = { value, sequence, members: Int32Array.from(members), leaderIndex };
    if (this.heap.length < this.limit) { this.heap.push(entry); this.siftUp(this.heap.length - 1); }
    else { this.heap[0] = entry; this.siftDown(0); }
  }

  merge(entries: TopEntry[]): void {
    for (const entry of entries) this.add(entry.value, entry.sequence, entry.members, entry.leaderIndex);
  }

  /** Best first; ties keep the earlier enumeration. */
  ranked(): TopEntry[] {
    return [...this.heap].sort((a, b) => (b.value - a.value) || (a.sequence - b.sequence));
  }

  private siftUp(start: number): void {
    const heap = this.heap;
    let i = start;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (below(heap[i], heap[parent])) { [heap[i], heap[parent]] = [heap[parent], heap[i]]; i = parent; }
      else break;
    }
  }

  private siftDown(start: number): void {
    const heap = this.heap;
    let i = start;
    for (;;) {
      const left = i * 2 + 1, right = left + 1;
      let smallest = i;
      if (left < heap.length && below(heap[left], heap[smallest])) smallest = left;
      if (right < heap.length && below(heap[right], heap[smallest])) smallest = right;
      if (smallest === i) break;
      [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
      i = smallest;
    }
  }
}
