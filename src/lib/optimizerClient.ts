/**
 * Drives the sweep across Web Workers and merges their Top-N.
 *
 * Worker count comes from the machine, never from the user: the page is one tab
 * among many and the browser schedules it. Progress is throttled rather than
 * reported per batch -- repainting on every batch is what made the desktop build
 * slower than its own worker pool.
 */
import { binomial, shardRanges } from '../engine/combinations';
import { TopN } from '../engine/topN';
import type { CardFacts, OutfitTable } from '../engine/types';
import type { SweepDone, SweepProgress, SweepRequest } from '../worker/sweep.worker';

export interface OptimizeOptions {
  facts: CardFacts[];
  outfits: OutfitTable;
  limit?: number;
  workers?: number;
  /** Card indices every team must contain. */
  required?: number[];
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface OptimizeRow { value: number; members: number[]; leaderIndex: number }

export interface OptimizeResult {
  rows: OptimizeRow[];
  combinations: number;
  /** Teams that passed the talent and pinned-card filters. */
  scored: number;
  evaluations: number;
  seconds: number;
  workers: number;
}

export function defaultWorkerCount(): number {
  // Beyond 8 the measured gain is a couple of seconds; some browsers also round
  // hardwareConcurrency for fingerprinting resistance, hence the fallback.
  return Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8));
}

export function optimize(options: OptimizeOptions): Promise<OptimizeResult> {
  const limit = options.limit ?? 50;
  const workerCount = options.workers ?? defaultWorkerCount();
  const total = binomial(options.facts.length, 5);
  const ranges = shardRanges(total, workerCount).filter(([start, end]) => end > start);
  const started = performance.now();

  return new Promise<OptimizeResult>((resolve, reject) => {
    const merged = new TopN(limit);
    const workers: Worker[] = [];
    const done = new Array<number>(ranges.length).fill(0);
    let finished = 0;
    let combinations = 0;
    let scored = 0;
    let evaluations = 0;
    let lastPaint = 0;

    const cleanup = () => workers.forEach((worker) => worker.terminate());

    const abort = () => { cleanup(); reject(new DOMException('cancelled', 'AbortError')); };
    options.signal?.addEventListener('abort', abort, { once: true });

    const report = () => {
      if (!options.onProgress) return;
      const now = performance.now();
      if (now - lastPaint < 120 && finished < ranges.length) return;   // ~8 fps is plenty
      lastPaint = now;
      let sum = 0;
      for (const value of done) sum += value;
      options.onProgress(sum, total);
    };

    ranges.forEach(([start, end], shard) => {
      const worker = new Worker(new URL('../worker/sweep.worker.ts', import.meta.url), { type: 'module' });
      workers.push(worker);
      worker.onerror = (event) => { cleanup(); reject(event.error ?? new Error('worker failed')); };
      worker.onmessage = (event: MessageEvent<SweepProgress | SweepDone>) => {
        const message = event.data;
        if (message.kind === 'progress') { done[shard] = message.combinationsDone; report(); return; }
        done[shard] = message.combinations;
        combinations += message.combinations;
        scored += message.scored;
        evaluations += message.evaluations;
        for (const entry of message.entries) {
          merged.add(entry.value, entry.sequence, entry.members, entry.leaderIndex);
        }
        worker.terminate();
        if (++finished === ranges.length) {
          options.signal?.removeEventListener('abort', abort);
          report();
          resolve({
            rows: merged.ranked().map((entry) => ({
              value: entry.value, members: Array.from(entry.members), leaderIndex: entry.leaderIndex,
            })),
            combinations, scored, evaluations,
            seconds: (performance.now() - started) / 1000,
            workers: ranges.length,
          });
        }
      };
      worker.postMessage({
        facts: options.facts,
        signatureOf: options.outfits.signatureOf,
        payloads: options.outfits.payloads,
        leaderCount: options.outfits.count,
        limit, start, end,
        required: options.required?.length ? Int32Array.from(options.required) : undefined,
      } satisfies SweepRequest);
    });
  });
}
