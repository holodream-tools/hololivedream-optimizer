/**
 * Everything the compare page needs, built on the ranking engine itself.
 *
 * Nothing here re-derives a formula. `memberPart`, `leaderPowerAndSupport`,
 * `expectedIndexOf` and `projectedScore` are the same functions the sweep and
 * the song page call, so a comparison can never disagree with the leaderboard
 * that produced it.
 *
 * The leave-one-out figures are counterfactuals, not scores of a legal team.
 * A member who is left out contributes nothing at all: not their parameters,
 * not their attribute or generation to a count, not the Passive they supply,
 * not the Passive they would receive, not their Active, not their Special.
 * The four who remain re-resolve every Passive target and every condition from
 * scratch. The Outfit itself stays -- it is a separate slot, not a sixth member
 * -- but its own condition is re-tested against the four, so an Outfit that
 * needed the departed member falls away with them.
 *
 * Consequently the five figures do not sum to the team's score, and nothing
 * should present them as if they did.
 */
import {
  activeConditionMet, expectedIndexOf, leaderPowerAndSupport, makeMemberState, memberPart,
} from './overallScore';
import { projectedScore } from './chartScore';
import type { CardFacts, OutfitPayload } from './types';
import type { ChartMemberDetail, ChartScoreResult, PreparedChart } from './chartScore';

/** Team-level figures, all read off one member evaluation. */
export interface GenericView {
  basePower: number;
  passiveGain: number;
  outfitGain: number;
  totalPower: number;
  passiveSupport: number;
  leaderSupport: number;
  specialSupport: number;
  sarPoints: number;
  activeScoreUp: number;
  /** Probability that at least one Active is up, i.e. 1 - prod(1 - p). */
  activeCoverage: number;
  index: number;
  members: DirectEffects[];
}

/** One member's own contribution channels -- the "分數構成／直接效果" view. */
export interface DirectEffects {
  slot: number;
  performance: number;
  technique: number;
  sense: number;
  base: number;
  /** Parameter points this member gained from Passives, whoever supplied them. */
  passiveGain: number;
  /** Parameter points this member gained from the Outfit. */
  outfitGain: number;
  /** Passive Score Support landing on this member. */
  passiveSupport: number;
  /** This member's Special, averaged over the 192-second reference song. */
  specialSupport: number;
  /** This member's Skill Activation Rate Up, 0 when its condition fails. */
  sarPoints: number;
  activeScoreUp: number;
  activeCoverage: number;
}

const scratchOutfit = new Float64Array(5);

/**
 * Read the per-member channels out of a finished member evaluation.
 *
 * `state` must be the one `memberPart` just filled, and `outfitPerMember` the
 * buffer `leaderPowerAndSupport` just wrote.
 */
function directEffects(state: ReturnType<typeof makeMemberState>,
                       outfitPerMember: Float64Array): DirectEffects[] {
  const out: DirectEffects[] = [];
  // Active entries were pushed in slot order, skipping members without one.
  let effect = 0;
  for (let i = 0; i < state.count; i++) {
    const row = state.rows[i];
    let passiveGain = 0;
    for (let k = 0; k < 3; k++) {
      const rate = state.rates[i * 3 + k];
      if (rate) passiveGain += Math.ceil(state.base[i * 3 + k] * rate / 100);
    }
    let activeScoreUp = 0, activeCoverage = 0;
    if (row.activePresent) {
      activeScoreUp = state.effectValues[effect];
      activeCoverage = state.effectProbabilities[effect];
      effect++;
    }
    const rateCondition = row.specialRateCondition;
    out.push({
      slot: i,
      performance: row.performance, technique: row.technique, sense: row.sense,
      base: row.total,
      passiveGain,
      outfitGain: outfitPerMember[i],
      passiveSupport: state.supports[i],
      specialSupport: row.specialSupportAverage,
      // Same gate the evaluation used, not a guess from the team total.
      sarPoints: row.specialSkillRateUp
        && (!rateCondition || activeConditionMet(rateCondition, state.typeCounts))
        ? row.specialSarAverage : 0,
      activeScoreUp, activeCoverage,
    });
  }
  return out;
}

export function genericView(facts: CardFacts[], indices: ArrayLike<number>,
                            payload: OutfitPayload | null): GenericView {
  const state = memberPart(facts, indices, makeMemberState());
  const [totalPower, leaderSupport] = leaderPowerAndSupport(payload, state, scratchOutfit);

  let basePower = 0;
  for (let i = 0; i < state.count; i++) basePower += state.rows[i].total;
  let misses = 1;
  for (let i = 0; i < state.effectCount; i++) misses *= 1 - state.effectProbabilities[i];

  return {
    basePower,
    passiveGain: state.memberPower - basePower,
    outfitGain: totalPower - state.memberPower,
    totalPower,
    passiveSupport: state.staticSupport,
    leaderSupport,
    specialSupport: state.specialSupport,
    sarPoints: state.sarPoints,
    activeScoreUp: state.activeScoreUp,
    activeCoverage: state.effectCount ? 1 - misses : 0,
    index: expectedIndexOf(payload, state),
    members: directEffects(state, scratchOutfit),
  };
}

/** Every arrangement of `values`; 120 for five members, 24 for four. */
function permutations(values: number[]): number[][] {
  if (values.length <= 1) return [values.slice()];
  const out: number[][] = [];
  for (let i = 0; i < values.length; i++) {
    const rest = [...values.slice(0, i), ...values.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([values[i], ...tail]);
  }
  return out;
}

export interface BestOrder {
  order: number[];
  score: number;
  worst: number;
  detail: ChartScoreResult;
}

/**
 * Best standing order for these members on this chart.
 *
 * Order matters because the Special slots fire at times the chart fixes, and
 * `memberPart` itself is order-sensitive on ties, so every arrangement is
 * evaluated in full rather than reusing one member evaluation.
 */
export function bestOrder(facts: CardFacts[], indices: number[],
                          payload: OutfitPayload | null, prepared: PreparedChart): BestOrder {
  const state = makeMemberState();
  let best: number[] | null = null;
  let bestScore = -Infinity;
  let worst = Infinity;
  for (const order of permutations(indices)) {
    memberPart(facts, order, state);
    const score = projectedScore(facts, order, payload, prepared, state).projectedScore;
    if (score > bestScore) { bestScore = score; best = order; }
    if (score < worst) worst = score;
  }
  memberPart(facts, best!, state);
  return {
    order: best!,
    score: bestScore,
    worst,
    detail: projectedScore(facts, best!, payload, prepared, state, true),
  };
}

/**
 * Leave-one-out on the recommendation index.
 *
 * Result[i] is what the team loses when member i takes no part: the full index
 * minus the index of the remaining four, each evaluated from scratch.
 */
export function leaveOneOutGeneric(facts: CardFacts[], indices: number[],
                                   payload: OutfitPayload | null): number[] {
  const full = genericView(facts, indices, payload).index;
  const state = makeMemberState();
  return indices.map((_, dropped) => {
    const rest = indices.filter((__, i) => i !== dropped);
    memberPart(facts, rest, state);
    return full - expectedIndexOf(payload, state);
  });
}

/**
 * Leave-one-out on a chart score, both sides at their own best standing order.
 *
 * The remaining four re-run all 4! arrangements rather than inheriting an order
 * that was optimised around the member who is now absent. They stand in the
 * chart's first four Special slots.
 */
export function leaveOneOutChart(facts: CardFacts[], indices: number[],
                                 payload: OutfitPayload | null,
                                 prepared: PreparedChart, fullScore: number): number[] {
  return indices.map((_, dropped) => {
    const rest = indices.filter((__, i) => i !== dropped);
    return fullScore - bestOrder(facts, rest, payload, prepared).score;
  });
}

/**
 * The one difference between two teams, when there is exactly one.
 *
 * A single swap needs no counterfactual at all: both sides are legal teams and
 * the gap between them is simply the gap. Two differences would fold two
 * variables into one number, so this reports nothing.
 */
export interface SingleSwap {
  kind: 'member' | 'leader';
  fromName: string;
  toName: string;
}

export function singleDifference(
  aMembers: string[], bMembers: string[], aLeader: string, bLeader: string,
  nameOf: (id: string) => string,
): SingleSwap | null {
  const sameLeader = aLeader === bLeader;
  const onlyA = aMembers.filter((id) => !bMembers.includes(id));
  const onlyB = bMembers.filter((id) => !aMembers.includes(id));
  if (sameLeader && onlyA.length === 1 && onlyB.length === 1) {
    return { kind: 'member', fromName: nameOf(onlyA[0]), toName: nameOf(onlyB[0]) };
  }
  if (!sameLeader && onlyA.length === 0 && onlyB.length === 0) {
    return { kind: 'leader', fromName: nameOf(aLeader), toName: nameOf(bLeader) };
  }
  return null;
}

export type { ChartMemberDetail };
