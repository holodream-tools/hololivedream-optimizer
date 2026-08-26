/**
 * Exhaustive Top-N sweep over five-member teams x Leader Outfits.
 *
 * Port of optimizer_fast._score_overall_chunk: the member side runs once per
 * combination instead of once per Outfit, and Outfits with identical payloads
 * share one computed value while every leader keeps its own sequence slot.
 *
 * Runs inside a worker over a contiguous range of the combination index, so it
 * can name the same global `sequence` the single-threaded reference would.
 */
import { nextCombination, unrank } from './combinations';
import { expectedIndexOf, makeMemberState, memberPart } from './overallScore';
import { TopN } from './topN';
import type { CardFacts, OutfitTable } from './types';

export interface SweepRange { start: number; end: number }

export interface SweepOptions {
  facts: CardFacts[];
  outfits: OutfitTable;
  limit: number;
  range: SweepRange;
  /**
   * Card indices that every team must contain. Enumeration still walks the full
   * combination space so `sequence` keeps its global meaning and the tie-break
   * is unchanged; combinations missing a pinned card are simply not scored.
   */
  required?: Int32Array;
  /** Called roughly every `reportEvery` combinations with combinations done. */
  onProgress?: (combinationsDone: number) => void;
  reportEvery?: number;
  shouldStop?: () => boolean;
}

export interface SweepResult {
  top: TopN;
  combinations: number;
  /** Combinations that passed the talent and pinned-card filters. */
  scored: number;
  evaluations: number;
  cancelled: boolean;
}

export function sweep(options: SweepOptions): SweepResult {
  const { facts, outfits, limit, range } = options;
  const reportEvery = options.reportEvery ?? 20000;
  const cardCount = facts.length;
  const leaderCount = outfits.count;
  const talents = facts.map((f) => f.talent);

  const required = options.required ?? new Int32Array(0);
  const top = new TopN(limit);
  const state = makeMemberState();
  const members = new Int32Array(5);
  const cached = new Float64Array(outfits.payloads.length);
  const seen = new Int32Array(outfits.payloads.length);
  let stamp = 0;

  unrank(cardCount, 5, range.start, members);
  let combinationIndex = range.start;
  let combinations = 0;
  let scored = 0;
  let evaluations = 0;
  let sinceReport = 0;

  while (combinationIndex < range.end) {
    // Five talents must be distinct: one talent cannot occupy two slots.
    let duplicate = false;
    for (let i = 0; i < 5 && !duplicate; i++) {
      for (let j = i + 1; j < 5; j++) {
        if (talents[members[i]] === talents[members[j]]) { duplicate = true; break; }
      }
    }

    let hasRequired = true;
    for (let r = 0; r < required.length && hasRequired; r++) {
      const wanted = required[r];
      let found = false;
      for (let i = 0; i < 5; i++) if (members[i] === wanted) { found = true; break; }
      hasRequired = found;
    }

    if (!duplicate && hasRequired) {
      scored++;
      memberPart(facts, members, state);
      stamp++;
      const base = combinationIndex * leaderCount;
      for (let leaderIndex = 0; leaderIndex < leaderCount; leaderIndex++) {
        const signature = outfits.signatureOf[leaderIndex];
        if (seen[signature] !== stamp) {
          seen[signature] = stamp;
          cached[signature] = expectedIndexOf(outfits.payloads[signature], state);
        }
        top.add(cached[signature], base + leaderIndex, members, leaderIndex);
      }
    }
    evaluations += leaderCount;
    combinations++;
    sinceReport++;

    if (sinceReport >= reportEvery) {
      sinceReport = 0;
      options.onProgress?.(combinations);
      if (options.shouldStop?.()) return { top, combinations, scored, evaluations, cancelled: true };
    }

    combinationIndex++;
    if (combinationIndex < range.end && !nextCombination(members, cardCount, 5)) break;
  }

  options.onProgress?.(combinations);
  return { top, combinations, scored, evaluations, cancelled: false };
}
