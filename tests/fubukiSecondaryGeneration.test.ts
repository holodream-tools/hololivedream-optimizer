/**
 * Shirakami Fubuki counts as 1期生 for group_count passives, not just GAMERS.
 *
 * These go past what PassiveConditions.tsx shows ("✓ 已觸發") and check the
 * engine's own numbers: the condition, who receives the effect, and the
 * resulting totalPower / index. `precompute.secondaryGenerationOf` is the fix
 * under test; see src/engine/overallScore.ts's generationCounts and target
 * eligibility for where it is consumed.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cardFacts } from '../src/engine/precompute';
import {
  conditionMet, expectedIndexOf, leaderPowerAndSupport, makeMemberState, memberPart,
} from '../src/engine/overallScore';
import type { CardBundle, OutfitCondition } from '../src/engine/types';

const bundle: CardBundle = JSON.parse(readFileSync(new URL('../public/data/cards.json', import.meta.url), 'utf8'));
const cardIndex = new Map(bundle.cards.map((c, i) => [c.id, i]));
const blooms = bundle.cards.map((c) => c.maxBloom);
const facts = cardFacts(bundle.cards, blooms);

function idxOf(id: string): number {
  const index = cardIndex.get(id);
  if (index === undefined) throw new Error(`fixture card missing from public/data/cards.json: ${id}`);
  return index;
}

/** Offsets into MemberState.rates, which is 5 x [performance, technique, sense]. */
const PERFORMANCE_OF_SLOT_0 = 0;
const PERFORMANCE_OF_SLOT_1 = 3;

const FUBUKI = idxOf('shirakami_fubuki_5');
const MATSURI = idxOf('natsuiro_matsuri_5'); // a real 1期生 member
const SUBARU = idxOf('oozora_subaru_5');     // 2期生 -- not a 1期生 partner
const SORA = idxOf('tokino_sora_5');
const MIKO = idxOf('sakura_miko_5');
const KORONE = idxOf('robocosan_5');

describe('Fubuki alone: no 1期生 partner', () => {
  it('does not meet her own passive condition, and her passive contributes nothing', () => {
    const state = memberPart(facts, [FUBUKI], makeMemberState());
    expect(state.generationCounts.get('1期生')).toBe(1); // herself, via the fix -- still short of 2
    expect(conditionMet(facts[FUBUKI].passiveCondition as OutfitCondition, state.typeCounts, state.generationCounts))
      .toBe(false);
    expect(state.rates[0]).toBe(0); // slot 0 = Fubuki, stat 0 = performance
    const [totalPower] = leaderPowerAndSupport(null, state);
    expect(totalPower).toBe(facts[FUBUKI].total); // exactly her own base total: no passive gain at all
  });

  it('matches the same result in a realistic 5-member team with no 1期生 partner', () => {
    const indices = [FUBUKI, SUBARU, SORA, MIKO, KORONE];
    const state = memberPart(facts, indices, makeMemberState());
    expect(conditionMet(facts[FUBUKI].passiveCondition as OutfitCondition, state.typeCounts, state.generationCounts))
      .toBe(false);
    expect(state.rates[0]).toBe(0); // Fubuki's own performance rate: untouched
  });
});

describe('Fubuki + one real 1期生 member', () => {
  it('meets her condition and applies her effect to both herself and the partner, by exactly her declared value', () => {
    const state = memberPart(facts, [FUBUKI, MATSURI], makeMemberState());
    expect(state.generationCounts.get('1期生')).toBe(2); // Fubuki (via the fix) + Matsuri
    expect(conditionMet(facts[FUBUKI].passiveCondition as OutfitCondition, state.typeCounts, state.generationCounts))
      .toBe(true);

    // Matsuri's own Support Skill is unconditional and ALSO targets the top 2
    // of 1期生 -- with the fix, that is the same two people, so both slots'
    // performance rate is the sum of both cards' declared passiveValue.
    const combined = facts[FUBUKI].passiveValue + facts[MATSURI].passiveValue;
    // `rates` is 5 x [performance, technique, sense]; performance is slot * 3.
    expect(state.rates[PERFORMANCE_OF_SLOT_0]).toBe(combined);   // Fubuki
    expect(state.rates[PERFORMANCE_OF_SLOT_1]).toBe(combined);   // Matsuri

    // totalPower is fully determined by these two cards alone (no fillers in
    // this team), so it can be checked bit-exactly against the engine's own
    // documented rounding rule: each member's own increment, ceil'd once per
    // parameter, off that member's OWN base stat.
    const [totalPower] = leaderPowerAndSupport(null, state);
    const fubukiGain = Math.ceil(facts[FUBUKI].performance * combined / 100);
    const matsuriGain = Math.ceil(facts[MATSURI].performance * combined / 100);
    expect(totalPower).toBe(facts[FUBUKI].total + facts[MATSURI].total + fubukiGain + matsuriGain);
    expect(totalPower).toBeGreaterThan(facts[FUBUKI].total + facts[MATSURI].total);
  });

  it('scores a realistic 5-member team higher than the same team with a non-1期生 in that slot', () => {
    const withPartner = memberPart(facts, [FUBUKI, MATSURI, SORA, MIKO, KORONE], makeMemberState());
    const withoutPartner = memberPart(facts, [FUBUKI, SUBARU, SORA, MIKO, KORONE], makeMemberState());
    expect(conditionMet(facts[FUBUKI].passiveCondition as OutfitCondition,
      withPartner.typeCounts, withPartner.generationCounts)).toBe(true);
    expect(conditionMet(facts[FUBUKI].passiveCondition as OutfitCondition,
      withoutPartner.typeCounts, withoutPartner.generationCounts)).toBe(false);

    const indexWith = expectedIndexOf(null, withPartner);
    const indexWithout = expectedIndexOf(null, withoutPartner);
    expect(indexWith).toBeGreaterThan(indexWithout);
  });
});
