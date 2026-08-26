/// <reference lib="webworker" />
/**
 * One shard of the exhaustive sweep. Receives a contiguous range of the
 * combination index and reports its local Top-N back as plain indices -- card
 * objects never cross the boundary.
 */
import { sweep } from '../engine/sweep';
import type { CardFacts, OutfitTable } from '../engine/types';

export interface SweepRequest {
  facts: CardFacts[];
  signatureOf: Int32Array;
  payloads: OutfitTable['payloads'];
  leaderCount: number;
  limit: number;
  start: number;
  end: number;
  required?: Int32Array;
}

export interface SweepProgress { kind: 'progress'; combinationsDone: number }
export interface SweepDone {
  kind: 'done';
  entries: Array<{ value: number; sequence: number; members: number[]; leaderIndex: number }>;
  combinations: number;
  scored: number;
  evaluations: number;
}

self.onmessage = (event: MessageEvent<SweepRequest>) => {
  const request = event.data;
  const outfits: OutfitTable = {
    signatureOf: request.signatureOf,
    payloads: request.payloads,
    count: request.leaderCount,
  };
  const result = sweep({
    facts: request.facts,
    outfits,
    limit: request.limit,
    range: { start: request.start, end: request.end },
    required: request.required,
    onProgress: (combinationsDone) => {
      (self as unknown as Worker).postMessage({ kind: 'progress', combinationsDone } satisfies SweepProgress);
    },
  });
  const entries = result.top.ranked().map((entry) => ({
    value: entry.value,
    sequence: entry.sequence,
    members: Array.from(entry.members),
    leaderIndex: entry.leaderIndex,
  }));
  (self as unknown as Worker).postMessage({
    kind: 'done', entries, combinations: result.combinations,
    scored: result.scored, evaluations: result.evaluations,
  } satisfies SweepDone);
};
