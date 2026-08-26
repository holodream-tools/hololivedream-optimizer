import { describe, expect, it } from 'vitest';
import { applyDiversity, NO_DIVERSITY } from '../src/engine/diversity';

const row = (members: number[], leaderIndex = 0, value = 0) => ({ members, leaderIndex, value });

describe('diversity filtering', () => {
  it('returns the list untouched when both checks are off', () => {
    const rows = [row([1, 2, 3, 4, 5]), row([1, 2, 3, 4, 5], 1)];
    expect(applyDiversity(rows, NO_DIVERSITY)).toEqual(rows);
  });

  it('keeps only the best Outfit for a repeated team', () => {
    const rows = [row([1, 2, 3, 4, 5], 0), row([1, 2, 3, 4, 5], 1), row([1, 2, 3, 4, 6], 0)];
    const kept = applyDiversity(rows, { oneLeaderPerTeam: true, minDistinctMembers: 0 });
    expect(kept).toHaveLength(2);
    expect(kept[0].leaderIndex).toBe(0);   // ranking order decides which survives
  });

  it('treats member order as irrelevant when detecting a repeat', () => {
    const rows = [row([1, 2, 3, 4, 5]), row([5, 4, 3, 2, 1], 1)];
    expect(applyDiversity(rows, { oneLeaderPerTeam: true, minDistinctMembers: 0 })).toHaveLength(1);
  });

  it('drops single-card variations when two new members are required', () => {
    const rows = [row([1, 2, 3, 4, 5]), row([1, 2, 3, 4, 6]), row([1, 2, 3, 7, 8])];
    const kept = applyDiversity(rows, { oneLeaderPerTeam: false, minDistinctMembers: 2 });
    expect(kept.map((entry) => entry.members)).toEqual([[1, 2, 3, 4, 5], [1, 2, 3, 7, 8]]);
  });

  it('compares against every kept row, not just the previous one', () => {
    // Each row differs from its neighbour by two, but row 3 is one card from row 1.
    const rows = [row([1, 2, 3, 4, 5]), row([1, 2, 3, 6, 7]), row([1, 2, 3, 4, 8])];
    const kept = applyDiversity(rows, { oneLeaderPerTeam: false, minDistinctMembers: 2 });
    expect(kept).toHaveLength(2);
  });

  it('always keeps the top row', () => {
    const rows = [row([1, 2, 3, 4, 5])];
    expect(applyDiversity(rows, { oneLeaderPerTeam: true, minDistinctMembers: 3 })).toHaveLength(1);
  });
});
