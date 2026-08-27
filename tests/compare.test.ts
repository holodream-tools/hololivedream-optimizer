/**
 * Leave-one-out is the one place a stale slot would go unnoticed.
 *
 * The member state carries five slots and is reused; a four-member evaluation
 * that failed to respect the count would keep reading the departed member's
 * row in the recipient ranking and the attribute counts. The resulting number
 * would be too small and entirely plausible, so these tests pin the properties
 * that only hold when the member really takes no part:
 *
 *   - the same drop scores the same whether the state is fresh or reused
 *   - the same drop scores the same however the input order is shuffled
 *
 * The chart test compares best-of-4! against best-of-4!, never a fixed order:
 * standing order moves the Special windows, so a fixed order would conflate
 * "member removed" with "arrangement no longer optimal".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bestOrder, genericView, leaveOneOutChart, leaveOneOutGeneric } from '../src/engine/compare';
import { materialize, prepare, projectedScore } from '../src/engine/chartScore';
import { expectedIndexOf, makeMemberState, memberPart } from '../src/engine/overallScore';
import { cardFacts, outfitTable } from '../src/engine/precompute';
import type { CardBundle } from '../src/engine/types';
import type { ChartMeta } from '../src/engine/chartScore';

const bundle: CardBundle = JSON.parse(
  readFileSync(new URL('../public/data/cards.json', import.meta.url), 'utf8'));
const chartMeta: { charts: ChartMeta[]; index: Record<string, [number, number, number]> } =
  JSON.parse(readFileSync(new URL('../public/data/charts.json', import.meta.url), 'utf8'));
const chartBlob = new Uint8Array(
  readFileSync(new URL('../public/data/charts.bin', import.meta.url))).buffer;

const blooms = bundle.cards.map((card) => card.maxBloom);
const facts = cardFacts(bundle.cards, blooms);
const outfits = outfitTable(bundle.leaders, bundle.leaders.map((l) => l.maxBloom));
const payload = outfits.payloads[outfits.signatureOf[0]];

/** Five distinct talents, taken from the front of the catalogue. */
const team: number[] = [];
const talents = new Set<string>();
for (let i = 0; i < facts.length && team.length < 5; i++) {
  if (!talents.has(facts[i].talent)) { talents.add(facts[i].talent); team.push(i); }
}

const someChart = chartMeta.charts.find((row) => row.difficulty === 'Expert')!;
const [offset, count] = chartMeta.index[someChart.key];
const prepared = prepare(someChart, materialize(chartBlob, offset, count));

/** [1,2,3,4,5] -> [3,5,1,4,2]; deterministic, and not the identity. */
function shuffled(values: number[]): number[] {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = (i * 7 + 3) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('leave-one-out', () => {
  it('picked five distinct talents to work with', () => {
    expect(team).toHaveLength(5);
  });

  it('drops a member the same way on a fresh state as on a reused one', () => {
    const rest = team.slice(1);

    const fresh = expectedIndexOf(payload, memberPart(facts, rest, makeMemberState()));

    // A state that has just scored a different five-member team: any slot the
    // four-member pass forgets to respect would still hold that team's data.
    const reused = makeMemberState();
    memberPart(facts, [team[4], team[3], team[2], team[1], team[0]], reused);
    expectedIndexOf(payload, reused);
    memberPart(facts, rest, reused);
    expect(expectedIndexOf(payload, reused)).toBe(fresh);
  });

  it('reports the same loss for a card however the team is ordered', () => {
    const order = shuffled(team);
    expect(order).not.toEqual(team);

    const straight = leaveOneOutGeneric(facts, team, payload);
    const jumbled = leaveOneOutGeneric(facts, order, payload);

    for (let i = 0; i < team.length; i++) {
      const moved = order.indexOf(team[i]);
      expect(jumbled[moved]).toBe(straight[i]);
    }
  });

  it('never claims a member is worth nothing at all', () => {
    const losses = leaveOneOutGeneric(facts, team, payload);
    expect(losses).toHaveLength(5);
    for (const loss of losses) expect(loss).toBeGreaterThan(0);
  });

  it('leaves the five-member evaluation itself untouched', () => {
    const view = genericView(facts, team, payload);
    const state = memberPart(facts, team, makeMemberState());
    expect(view.index).toBe(expectedIndexOf(payload, state));
    expect(view.totalPower - view.outfitGain).toBe(state.memberPower);
  });
});

describe('leave-one-out on a chart', () => {
  it('finds the same best four-member score whatever the input order', () => {
    const order = shuffled(team);
    // Best-of-4! against best-of-4!: the permutation set does not depend on the
    // order the four arrive in, so the maximum over it must not either.
    for (let i = 0; i < team.length; i++) {
      const dropped = team[i];
      const straight = bestOrder(facts, team.filter((x) => x !== dropped), payload, prepared);
      const jumbled = bestOrder(facts, order.filter((x) => x !== dropped), payload, prepared);
      expect(jumbled.score).toBe(straight.score);
    }
  });

  it('measures the loss against the four-member best, not the five-member order', () => {
    const full = bestOrder(facts, team, payload, prepared);
    const losses = leaveOneOutChart(facts, team, payload, prepared, full.score);
    expect(losses).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      const rest = team.filter((_, index) => index !== i);
      const withoutBest = bestOrder(facts, rest, payload, prepared);
      expect(losses[i]).toBe(full.score - withoutBest.score);
      // Why re-optimise at all: the four left standing in the order that was
      // chosen around the missing member can only do worse than their own best.
      const inherited = full.order.filter((cardIndex) => cardIndex !== team[i]);
      expect(withoutBest.score).toBeGreaterThanOrEqual(
        projectedScore(facts, inherited, payload, prepared).projectedScore,
      );
    }
  });

  it('reports per-member chart coverage for the winning order', () => {
    const full = bestOrder(facts, team, payload, prepared);
    expect(full.detail.members).toHaveLength(5);
    for (const member of full.detail.members!) {
      expect(member.specialCoverage).toBeGreaterThanOrEqual(0);
      expect(member.specialCoverage).toBeLessThanOrEqual(1);
      expect(member.activeCoverage).toBeGreaterThanOrEqual(0);
      expect(member.activeCoverage).toBeLessThanOrEqual(1);
    }
  });
});
