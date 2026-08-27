/**
 * Song-mode optimisation: a funnel, and honest about being one.
 *
 * A full song sweep does not exist. Chart scoring costs about 58 us against the
 * generic model's 0.13 us, and every team must try all 120 standing orders, so
 * brute force over 66 cards runs to roughly 26 years. What is affordable is
 * rescoring the generic sweep's own leaders.
 *
 * Measured over six charts chosen for opposite shapes -- 415 to 2022 notes, 90
 * to 166 seconds, note density flat to sharply peaked -- against a pool of 1000
 * distinct formations:
 *
 *   - the song champion never sat deeper than generic rank #50 (6/6 at K=50)
 *   - the complete song top 10 needed K=1000; at K=500 it was 0/6
 *   - the generic #1 team ranked 22nd to 410th on the song it was asked to play,
 *     losing 2.5% to 10.9% against the song's own best team
 *
 * That last line is the reason this mode exists. The first two are why K is a
 * choice the player makes rather than a constant.
 *
 * Each formation keeps the Outfit the generic sweep chose for it: over 16 tests
 * on two charts of opposite length the song-best Outfit was the generic-best
 * Outfit every time, so re-optimising it would multiply the cost by 41 payloads
 * to change nothing.
 */
import { bestOrder } from './compare';
import type { CardFacts, OutfitPayload } from './types';
import type { ChartScoreResult, PreparedChart } from './chartScore';

/** Candidate depths, and what each one actually buys. */
export const FUNNEL_DEPTHS = [
  { k: 200, label: '快速', note: '從通用排名前 200 組隊伍計算' },
  { k: 1000, label: '完整 Top 10', note: '從通用排名前 1000 組隊伍計算' },
] as const;

export interface SongCandidate {
  /** Rank among DISTINCT formations, not among raw sweep entries. */
  genericRank: number;
  genericValue: number;
  members: number[];
  leaderIndex: number;
}

export interface SongScored extends SongCandidate {
  songScore: number;
  /** Member indices in Special-slot order. */
  order: number[];
}

export interface SongRanked extends SongScored {
  songRank: number;
  detail: ChartScoreResult;
}

/**
 * Collapse the sweep's rows to one entry per set of five members.
 *
 * The rows arrive best-first, so the first sighting of a formation already
 * carries the Outfit the generic model preferred for it.
 */
export function distinctFormations(
  rows: ReadonlyArray<{ value: number; members: number[]; leaderIndex: number }>,
): SongCandidate[] {
  const out: SongCandidate[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.members.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      genericRank: out.length + 1,
      genericValue: row.value,
      members: row.members.slice(),
      leaderIndex: row.leaderIndex,
    });
  }
  return out;
}

/**
 * Score candidates [from, to) onto `out`.
 *
 * Sliced so the caller can yield to the browser between batches: the deep run is
 * six seconds of arithmetic and a frozen page is not an acceptable way to spend
 * it. The per-member detail is skipped here and rebuilt only for the rows that
 * end up on screen.
 */
export function scoreCandidates(
  facts: CardFacts[], candidates: readonly SongCandidate[],
  payloadOf: (leaderIndex: number) => OutfitPayload | null,
  prepared: PreparedChart, from: number, to: number, out: SongScored[],
): void {
  for (let i = from; i < to && i < candidates.length; i++) {
    const candidate = candidates[i];
    const best = bestOrder(facts, candidate.members, payloadOf(candidate.leaderIndex), prepared, false);
    out.push({ ...candidate, songScore: best.score, order: best.order });
  }
}

/**
 * Rank by song score, and rebuild the detail for the top `detailCount`.
 *
 * Ties keep the better generic rank, which is the sweep's own tie-break carried
 * forward: two teams that score the same on this chart are then separated by the
 * thing that separated them before.
 */
export function rankSongResults(
  facts: CardFacts[], scored: readonly SongScored[],
  payloadOf: (leaderIndex: number) => OutfitPayload | null,
  prepared: PreparedChart, detailCount: number,
): SongRanked[] {
  const sorted = [...scored].sort((a, b) =>
    (b.songScore - a.songScore) || (a.genericRank - b.genericRank));
  return sorted.slice(0, detailCount).map((row, index) => ({
    ...row,
    songRank: index + 1,
    detail: bestOrder(facts, row.members, payloadOf(row.leaderIndex), prepared).detail,
  }));
}

/**
 * How much the song's best team beats the generic best team, on this song.
 *
 * Returns null when the generic #1 formation is not in the scored pool, which
 * cannot happen for any K >= 1 but is not worth asserting over.
 */
export function upliftOverGenericBest(ranked: readonly SongRanked[],
                                      scored: readonly SongScored[]): {
  genericBestScore: number; genericBestSongRank: number; uplift: number;
} | null {
  if (!ranked.length || !scored.length) return null;
  const genericBest = scored.find((row) => row.genericRank === 1);
  if (!genericBest) return null;
  const sorted = [...scored].sort((a, b) =>
    (b.songScore - a.songScore) || (a.genericRank - b.genericRank));
  return {
    genericBestScore: genericBest.songScore,
    genericBestSongRank: sorted.indexOf(genericBest) + 1,
    uplift: genericBest.songScore
      ? ranked[0].songScore / genericBest.songScore - 1 : 0,
  };
}
