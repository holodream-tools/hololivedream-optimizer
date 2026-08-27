/**
 * The funnel must not invent a winner the pool does not contain, and must not
 * miss the one it does. Everything here checks the plumbing between the generic
 * ranking and the chart rescoring; how deep the pool should be is a measured
 * question, recorded in songOptimize.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bestOrder } from '../src/engine/compare';
import { materialize, prepare } from '../src/engine/chartScore';
import { cardFacts, outfitTable } from '../src/engine/precompute';
import {
  distinctFormations, rankSongResults, scoreCandidates, upliftOverGenericBest,
} from '../src/engine/songOptimize';
import type { CardBundle } from '../src/engine/types';
import type { ChartMeta } from '../src/engine/chartScore';
import type { SongScored } from '../src/engine/songOptimize';

const bundle: CardBundle = JSON.parse(
  readFileSync(new URL('../public/data/cards.json', import.meta.url), 'utf8'));
const chartFile: { charts: ChartMeta[]; index: Record<string, [number, number, number]> } =
  JSON.parse(readFileSync(new URL('../public/data/charts.json', import.meta.url), 'utf8'));
const blob = new Uint8Array(
  readFileSync(new URL('../public/data/charts.bin', import.meta.url))).buffer;

const facts = cardFacts(bundle.cards, bundle.cards.map((card) => card.maxBloom));
const outfits = outfitTable(bundle.leaders, bundle.leaders.map((leader) => leader.maxBloom));
const payloadOf = (leaderIndex: number) => outfits.payloads[outfits.signatureOf[leaderIndex]];

const meta = chartFile.charts.find((row) => row.difficulty === 'Expert')!;
const [offset, count] = chartFile.index[meta.key];
const prepared = prepare(meta, materialize(blob, offset, count));

/** A few legal formations, distinct talents within each. */
function formation(seed: number): number[] {
  const members: number[] = [];
  const used = new Set<string>();
  for (let i = seed; i < facts.length && members.length < 5; i++) {
    if (!used.has(facts[i].talent)) { used.add(facts[i].talent); members.push(i); }
  }
  return members;
}
const teams = [0, 4, 9, 14, 19, 25].map(formation).filter((row) => row.length === 5);

describe('distinctFormations', () => {
  it('keeps one entry per set of five, with the Outfit the sweep preferred', () => {
    const rows = [
      { value: 900, members: teams[0], leaderIndex: 3 },
      { value: 880, members: teams[0], leaderIndex: 7 },   // same five, worse Outfit
      { value: 870, members: teams[1], leaderIndex: 2 },
      { value: 860, members: teams[0], leaderIndex: 9 },
    ];
    const out = distinctFormations(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ genericRank: 1, genericValue: 900, leaderIndex: 3 });
    expect(out[1]).toMatchObject({ genericRank: 2, genericValue: 870, leaderIndex: 2 });
  });

  it('numbers ranks over distinct formations, not over raw sweep entries', () => {
    const rows = teams.flatMap((members, index) =>
      [0, 1, 2].map((n) => ({ value: 1000 - index * 10 - n, members, leaderIndex: n })));
    const out = distinctFormations(rows);
    expect(out.map((row) => row.genericRank)).toEqual(teams.map((_, i) => i + 1));
  });
});

describe('the funnel', () => {
  const candidates = distinctFormations(
    teams.map((members, index) => ({ value: 1000 - index, members, leaderIndex: index })));

  it('scores in batches to the same result as scoring in one pass', () => {
    const oneGo: SongScored[] = [];
    scoreCandidates(facts, candidates, payloadOf, prepared, 0, candidates.length, oneGo);

    const batched: SongScored[] = [];
    for (let i = 0; i < candidates.length; i += 2) {
      scoreCandidates(facts, candidates, payloadOf, prepared, i, i + 2, batched);
    }
    expect(batched).toEqual(oneGo);
  });

  it('picks the pool member that really scores highest on the chart', () => {
    const scored: SongScored[] = [];
    scoreCandidates(facts, candidates, payloadOf, prepared, 0, candidates.length, scored);

    // Independent of the funnel: score every candidate directly and take the max.
    const direct = candidates
      .map((row) => bestOrder(facts, row.members, payloadOf(row.leaderIndex), prepared).score)
      .reduce((best, score) => Math.max(best, score), -Infinity);

    const ranked = rankSongResults(facts, scored, payloadOf, prepared, 10);
    expect(ranked[0].songScore).toBe(direct);
    expect(ranked.map((row) => row.songRank)).toEqual(ranked.map((_, i) => i + 1));
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].songScore).toBeGreaterThanOrEqual(ranked[i].songScore);
    }
  });

  it('reports the order it scored, and that order really is the best one', () => {
    const scored: SongScored[] = [];
    scoreCandidates(facts, candidates, payloadOf, prepared, 0, 1, scored);
    const winner = scored[0];
    const direct = bestOrder(facts, winner.members, payloadOf(winner.leaderIndex), prepared);
    expect(winner.order).toEqual(direct.order);
    expect(winner.songScore).toBe(direct.score);
  });

  it('returns an order made of the candidate\'s own card indices', () => {
    // Not 0..4. The candidate's members are indices into the full card list, and
    // the order permutes those, so a caller that maps through `members` again
    // reads out of range -- which is exactly how it was got wrong once.
    const scored: SongScored[] = [];
    scoreCandidates(facts, candidates, payloadOf, prepared, 0, candidates.length, scored);
    for (const row of scored) {
      expect([...row.order].sort((a, b) => a - b)).toEqual([...row.members].sort((a, b) => a - b));
    }
    expect(scored.some((row) => row.order.some((value) => value > 4))).toBe(true);
  });

  it('measures the uplift against the generic best team on this same chart', () => {
    const scored: SongScored[] = [];
    scoreCandidates(facts, candidates, payloadOf, prepared, 0, candidates.length, scored);
    const ranked = rankSongResults(facts, scored, payloadOf, prepared, 10);
    const uplift = upliftOverGenericBest(ranked, scored)!;

    const genericBest = scored.find((row) => row.genericRank === 1)!;
    expect(uplift.genericBestScore).toBe(genericBest.songScore);
    expect(uplift.uplift).toBeCloseTo(ranked[0].songScore / genericBest.songScore - 1, 12);
    // The song winner is by definition at least as good as any pool member.
    expect(uplift.uplift).toBeGreaterThanOrEqual(0);
  });

  it('separates equal chart scores by the generic ranking, as the sweep does', () => {
    const tied: SongScored[] = [
      { genericRank: 9, genericValue: 1, members: teams[0], leaderIndex: 0, songScore: 500, order: [0, 1, 2, 3, 4] },
      { genericRank: 2, genericValue: 2, members: teams[1], leaderIndex: 0, songScore: 500, order: [0, 1, 2, 3, 4] },
    ];
    const ranked = rankSongResults(facts, tied, payloadOf, prepared, 10);
    expect(ranked[0].genericRank).toBe(2);
  });
});
