/**
 * Thin out near-duplicate results.
 *
 * A raw Top-N is dominated by one strong core: the same five members appear
 * several times under different Leader Outfits, and neighbouring ranks differ by
 * a single swapped card. Measured on real data, only 30 of 50 rows were distinct
 * teams and 23 of 49 differed from the row above by at most one card.
 *
 * Filtering happens AFTER ranking, never during the sweep: the scores and their
 * order are untouched, rows are only hidden. Turning the filter off restores the
 * exact list the optimizer produced.
 */

export interface DiversityOptions {
  /** Keep only the best Outfit for any given set of five members. */
  oneLeaderPerTeam: boolean;
  /**
   * Minimum members that must differ from every row already kept. 0 disables the
   * check, 1 only removes exact repeats, 2 drops single-card variations.
   */
  minDistinctMembers: number;
}

export const NO_DIVERSITY: DiversityOptions = { oneLeaderPerTeam: false, minDistinctMembers: 0 };

/** Number of members in `candidate` that `kept` does not contain. */
function newMembers(candidate: ArrayLike<number>, kept: ReadonlySet<number>): number {
  let count = 0;
  for (let i = 0; i < candidate.length; i++) if (!kept.has(candidate[i])) count++;
  return count;
}

export function applyDiversity<T extends { members: ArrayLike<number> }>(
  rows: readonly T[], options: DiversityOptions,
): T[] {
  if (!options.oneLeaderPerTeam && options.minDistinctMembers <= 0) return [...rows];

  const seenTeams = new Set<string>();
  const keptSets: Array<Set<number>> = [];
  const kept: T[] = [];

  for (const row of rows) {
    const members = Array.from(row.members);
    if (options.oneLeaderPerTeam) {
      const key = [...members].sort((a, b) => a - b).join(',');
      if (seenTeams.has(key)) continue;
      seenTeams.add(key);
    }
    if (options.minDistinctMembers > 0) {
      const set = new Set(members);
      // Compared against every kept row, not just the previous one: otherwise a
      // long chain of one-card swaps still walks the whole list.
      const tooSimilar = keptSets.some((previous) => newMembers(members, previous) < options.minDistinctMembers);
      if (tooSimilar) continue;
      keptSets.push(set);
    }
    kept.push(row);
  }
  return kept;
}
