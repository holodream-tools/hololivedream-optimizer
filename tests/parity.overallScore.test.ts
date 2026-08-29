/**
 * The TypeScript engine must agree with the Python reference bit for bit.
 *
 * Not `toBeCloseTo`: ~21% of scores are exact ties in real data, so a value that
 * drifts in its last bits can reorder the Top-N. Fixtures come from
 * tools/export_truth.py and cover random per-card Bloom levels.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cardFacts, outfitTable } from '../src/engine/precompute';
import { expectedIndexOf, leaderPowerAndSupport, makeMemberState, memberPart } from '../src/engine/overallScore';
import type { CardBundle } from '../src/engine/types';

interface Case {
  cardIds: string[]; cardBlooms: number[];
  leaderId: string; leaderBloom: number;
  expectedIndex: number; totalPower: number; activeScoreUp: number;
}

const bundle: CardBundle = JSON.parse(readFileSync(new URL('../public/data/cards.json', import.meta.url), 'utf8'));
const allCases: Case[] = JSON.parse(readFileSync(new URL('./fixtures/overall_score.json', import.meta.url), 'utf8'));

const cardIndex = new Map(bundle.cards.map((c, i) => [c.id, i]));
const leaderIndex = new Map(bundle.leaders.map((l, i) => [l.id, i]));
const generationOf = new Map(bundle.cards.map((c) => [c.id, c.generation]));

/**
 * Fixtures come from the Python reference reading `generation` straight off
 * the upstream dataset, one group per card -- the same field precompute
 * .secondaryGenerationOf now corrects for Shirakami Fubuki, who the data
 * files under GAMERS but who is also an original 1期生 member (her own
 * Support Skill's "1期生 x2" condition assumes it). A team of her plus
 * another 1期生 member now scores higher here than the fixture recorded,
 * which is the fix working, not a parity break -- the Python side was never
 * asked about this case and inherits the same one-group limitation.
 */
const FUBUKI = 'shirakami_fubuki_5';
function affectedByFubukiFix(testCase: Case): boolean {
  return testCase.cardIds.includes(FUBUKI)
    && testCase.cardIds.some((id) => id !== FUBUKI && generationOf.get(id) === '1期生');
}
const cases = allCases.filter((testCase) => !affectedByFubukiFix(testCase));

describe('overallScore parity with the Python engine', () => {
  it('has fixtures covering every passive effect type', () => {
    const seen = new Set<string>();
    for (const testCase of allCases) {
      testCase.cardIds.forEach((id, slot) => {
        const card = bundle.cards[cardIndex.get(id)!];
        const effect = card.blooms[String(testCase.cardBlooms[slot])]?.support?.effect_type;
        if (typeof effect === 'string') seen.add(effect);
      });
    }
    expect(seen.size).toBe(8);
  });

  it('reproduces every expected_index bit for bit', () => {
    const state = makeMemberState();
    const mismatches: string[] = [];
    for (const testCase of cases) {
      const members = testCase.cardIds.map((id) => cardIndex.get(id)!);
      // Only the five members' Blooms matter, so build a table for those slots.
      const blooms = bundle.cards.map(() => 0);
      members.forEach((index, slot) => { blooms[index] = testCase.cardBlooms[slot]; });
      const facts = cardFacts(bundle.cards, blooms);

      const li = leaderIndex.get(testCase.leaderId)!;
      const leaderBlooms = bundle.leaders.map((l) => l.maxBloom);
      leaderBlooms[li] = testCase.leaderBloom;
      const outfits = outfitTable(bundle.leaders, leaderBlooms);

      memberPart(facts, members, state);
      const got = expectedIndexOf(outfits.payloads[outfits.signatureOf[li]], state);
      if (got !== testCase.expectedIndex) {
        mismatches.push(`${testCase.cardIds.join(',')} + ${testCase.leaderId}: ${got} !== ${testCase.expectedIndex}`);
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(mismatches.length).toBe(0);
  });

  it('reproduces total_power and the active expectation', () => {
    const state = makeMemberState();
    for (const testCase of cases) {
      const members = testCase.cardIds.map((id) => cardIndex.get(id)!);
      const blooms = bundle.cards.map(() => 0);
      members.forEach((index, slot) => { blooms[index] = testCase.cardBlooms[slot]; });
      const facts = cardFacts(bundle.cards, blooms);

      const li = leaderIndex.get(testCase.leaderId)!;
      const leaderBlooms = bundle.leaders.map((l) => l.maxBloom);
      leaderBlooms[li] = testCase.leaderBloom;
      const outfits = outfitTable(bundle.leaders, leaderBlooms);

      memberPart(facts, members, state);
      const [totalPower] = leaderPowerAndSupport(outfits.payloads[outfits.signatureOf[li]], state);
      expect(totalPower).toBe(testCase.totalPower);
      expect(state.activeScoreUp).toBe(testCase.activeScoreUp);
    }
  });
});
