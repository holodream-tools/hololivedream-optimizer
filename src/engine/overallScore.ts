/**
 * Chart-agnostic team recommendation index.
 *
 * Port of app/engine/overall_score.py, split along the same dependency boundary:
 * `memberPart` covers everything that depends only on the five members (81% of
 * the work), `expectedIndexOf` applies one Leader Outfit on top. Arithmetic order
 * and rounding follow the Python source exactly, so results are bit-identical --
 * see tests/parity.overallScore.test.ts.
 */
import { expectedMaximum } from './active';
import type { CardFacts, OutfitCondition, OutfitPayload } from './types';

const ALL_PARAM = new Set(['self_all_param_conditional', 'type_all_param']);
const ONE_STAT = new Set(['group_stat', 'group_stat_conditional', 'type_stat', 'type_stat_conditional']);
const SCORE_SUPPORT = new Set(['type_score_support', 'group_score_support_conditional']);
const STAT_SLOT: Record<string, number> = { performance: 0, technique: 1, sense: 2 };

/** Reusable buffers: the optimizer calls memberPart millions of times. */
export interface MemberState {
  rows: CardFacts[];
  base: Float64Array;       // 5 x [performance, technique, sense]; never mutated after load
  rates: Float64Array;      // 5 x [performance, technique, sense]; accumulated percentages
  totals: Float64Array;
  statKeys: Float64Array;
  supports: Float64Array;
  order: Int32Array;
  recipients: Int32Array;
  eligible: Int32Array;
  effectValues: Float64Array;
  effectProbabilities: Float64Array;
  typeCounts: Map<string, number>;
  generationCounts: Map<string, number>;
  /**
   * How many members this state currently holds. Five for every ranking path;
   * four only for the compare page's leave-one-out, which measures a member's
   * absence through this same formula rather than a second copy of it.
   */
  count: number;
  memberPower: number;      // base parameters plus the Passive increment
  staticSupport: number;
  specialSupport: number;
  activeScoreUp: number;
  /** Summed Skill Activation Rate Up, the value the Active probabilities used. */
  sarPoints: number;
  /** How many entries of effectValues/effectProbabilities are live. */
  effectCount: number;
}

export function makeMemberState(): MemberState {
  return {
    rows: new Array(5), base: new Float64Array(15), rates: new Float64Array(15),
    totals: new Float64Array(5), statKeys: new Float64Array(5),
    supports: new Float64Array(5), order: new Int32Array(5),
    recipients: new Int32Array(5), eligible: new Int32Array(5),
    effectValues: new Float64Array(5), effectProbabilities: new Float64Array(5),
    typeCounts: new Map(), generationCounts: new Map(),
    count: 5, memberPower: 0,
    staticSupport: 0, specialSupport: 0, activeScoreUp: 0,
    sarPoints: 0, effectCount: 0,
  };
}

/** Port of static_team._condition_matches, driven by precounted members. */
export function conditionMet(condition: OutfitCondition | null | undefined,
                             typeCounts: Map<string, number>,
                             generationCounts: Map<string, number>): boolean {
  if (!condition) return true;
  if (condition.type === 'type_count') {
    return (typeCounts.get(String(condition.type_name ?? '').toLowerCase()) ?? 0) >= (condition.min_count ?? 0);
  }
  if (condition.type === 'group_count') {
    return (generationCounts.get(condition.group as string) ?? 0) >= (condition.min_count ?? 0);
  }
  return false;
}

/** Insertion sort of `slice` by (-keys[i], i); n is at most 5. */
function sortByKey(slice: Int32Array, n: number, keys: Float64Array): void {
  for (let i = 1; i < n; i++) {
    const key = slice[i];
    let j = i - 1;
    while (j >= 0 && (keys[slice[j]] < keys[key] || (keys[slice[j]] === keys[key] && slice[j] > key))) {
      slice[j + 1] = slice[j]; j--;
    }
    slice[j + 1] = key;
  }
}

/**
 * Generic Active condition check, driven by precounted member attributes.
 *
 * Attribute conditions are team facts. Combo and Life conditions have no chart
 * to test against here, so they follow the same assumptions the chart model
 * already makes: a Perfect run never drops Life, and the only Combo threshold
 * in the data (40) is passed within the first seconds of any song.
 */
export function activeConditionMet(condition: unknown, typeCounts: Map<string, number>): boolean {
  if (typeof condition !== 'string') return false;
  if (condition.endsWith('_2')) return (typeCounts.get(condition.slice(0, -2).toLowerCase()) ?? 0) >= 2;
  if (condition.startsWith('life_')) return Number(condition.slice(condition.lastIndexOf('_') + 1)) <= 1000;
  // Combo thresholds are passed within the first seconds of any song. That
  // slightly overstates the opening, where the threshold is not reached yet;
  // the chart model times it exactly.
  if (condition.startsWith('combo_')) return true;
  return false;
}

export function memberPart(facts: CardFacts[], indices: ArrayLike<number>, state: MemberState): MemberState {
  const { rows, base, rates, totals, supports, statKeys, typeCounts, generationCounts } = state;
  const count = indices.length;
  state.count = count;
  typeCounts.clear();
  generationCounts.clear();
  for (let i = 0; i < count; i++) {
    const f = facts[indices[i]];
    rows[i] = f;
    base[i * 3] = f.performance; base[i * 3 + 1] = f.technique; base[i * 3 + 2] = f.sense;
    rates[i * 3] = 0; rates[i * 3 + 1] = 0; rates[i * 3 + 2] = 0;
    totals[i] = f.total; supports[i] = 0;
    typeCounts.set(f.type, (typeCounts.get(f.type) ?? 0) + 1);
    generationCounts.set(f.generation, (generationCounts.get(f.generation) ?? 0) + 1);
  }

  // Owner order comes from the base totals, exactly as the reference does.
  const order = state.order;
  for (let i = 0; i < count; i++) order[i] = i;
  sortByKey(order, count, totals);

  const { recipients, eligible } = state;
  for (let oi = 0; oi < count; oi++) {
    const owner = order[oi];
    const row = rows[owner];
    const effect = row.passiveEffect;
    if (!effect || !conditionMet(row.passiveCondition, typeCounts, generationCounts)) continue;

    const oneStat = ONE_STAT.has(effect);
    const slot = oneStat ? STAT_SLOT[row.passiveStat ?? ''] : undefined;
    if (oneStat && slot === undefined) continue;   // unknown stat: reported, never applied

    const target = row.passiveTarget as { type_match?: string; group?: string; count?: number } | string | null;
    let recipientCount = 0;
    if (target === 'self') {
      recipients[0] = owner; recipientCount = 1;
    } else if (target && typeof target === 'object') {
      let eligibleCount = 0;
      if ('type_match' in target && target.type_match !== undefined) {
        const wanted = String(target.type_match).toLowerCase();
        for (let i = 0; i < count; i++) if (rows[i].type === wanted) eligible[eligibleCount++] = i;
      } else if ('group' in target && target.group !== undefined) {
        const wanted = target.group;
        for (let i = 0; i < count; i++) if (rows[i].generation === wanted) eligible[eligibleCount++] = i;
      }
      // Recipients rank on BASE parameters: on the parameter the effect raises
      // for a single-stat effect, on the base total otherwise. Nothing an
      // earlier Passive did can move a later one onto a different member.
      if (slot === undefined) {
        sortByKey(eligible, eligibleCount, totals);
      } else {
        for (let i = 0; i < count; i++) statKeys[i] = base[i * 3 + slot];
        sortByKey(eligible, eligibleCount, statKeys);
      }
      recipientCount = Math.min(target.count ?? 0, eligibleCount);
      for (let i = 0; i < recipientCount; i++) recipients[i] = eligible[i];
    }
    if (recipientCount === 0) continue;

    const value = row.passiveValue;
    if (ALL_PARAM.has(effect)) {
      for (let r = 0; r < recipientCount; r++) {
        const at = recipients[r] * 3;
        rates[at] += value; rates[at + 1] += value; rates[at + 2] += value;
      }
    } else if (oneStat) {
      for (let r = 0; r < recipientCount; r++) rates[recipients[r] * 3 + slot!] += value;
    } else if (SCORE_SUPPORT.has(effect)) {
      for (let r = 0; r < recipientCount; r++) supports[recipients[r]] += value;
    }
  }

  // Each member's own increment, rounded up once per parameter.
  let memberPower = 0;
  for (let i = 0; i < count; i++) memberPower += totals[i];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      const rate = rates[i * 3 + k];
      if (rate) memberPower += Math.ceil(base[i * 3 + k] * rate / 100);
    }
  }
  state.memberPower = memberPower;

  // Each Rate Up window contributes its own rate for its own duration, so the
  // average is sum(rate x duration) / song. A gated Rate Up goes through the
  // same test as a gated Active value.
  let staticSupport = 0, specialSupport = 0, sarPoints = 0;
  for (let i = 0; i < count; i++) {
    staticSupport += supports[i];
    specialSupport += rows[i].specialSupportAverage;
    const rateCondition = rows[i].specialRateCondition;
    if (rows[i].specialSkillRateUp
        && (!rateCondition || activeConditionMet(rateCondition, typeCounts))) {
      sarPoints += rows[i].specialSarAverage;
    }
  }

  const { effectValues, effectProbabilities } = state;
  let effectCount = 0;
  for (let i = 0; i < count; i++) {
    const f = rows[i];
    if (!f.activePresent) continue;
    const probability = Math.min(1, f.activeProbability * (1 + sarPoints / 100));
    const coverage = f.activeInterval > 0
      ? Math.min(1, probability * f.activeDuration / f.activeInterval) : 0;
    let scoreUp = f.activeScoreUp;
    if (f.activeConditionalScoreUp !== null && activeConditionMet(f.activeCondition, typeCounts)) {
      scoreUp = f.activeConditionalScoreUp;
    }
    effectValues[effectCount] = scoreUp;
    effectProbabilities[effectCount] = coverage;
    effectCount++;
  }

  state.staticSupport = staticSupport;
  state.specialSupport = specialSupport;
  state.sarPoints = sarPoints;
  state.effectCount = effectCount;
  state.activeScoreUp = expectedMaximum(effectValues, effectProbabilities, effectCount);
  return state;
}

/**
 * Apply one Outfit as a separate additive term over the base parameters.
 *
 * `perMember` is an optional out-parameter for the compare page, which needs
 * each member's own increment. The ranking path passes nothing and pays one
 * branch per member for it, rather than a second copy of the rounding rule.
 */
export function leaderPowerAndSupport(payload: OutfitPayload | null, state: MemberState,
                                      perMember?: Float64Array): [number, number] {
  if (!payload || !conditionMet(payload.condition, state.typeCounts, state.generationCounts)) {
    if (perMember) perMember.fill(0);
    return [state.memberPower, 0];
  }
  const effects = payload.effects ?? [];
  let rp = 0, rt = 0, rs = 0, support = 0;
  for (const effect of effects) {
    if ((effect.target ?? 'all') !== 'all') continue;
    const value = Number(effect.value ?? 0);
    switch (effect.stat) {
      case 'all': rp += value; rt += value; rs += value; break;
      case 'performance': rp += value; break;
      case 'technique': rt += value; break;
      case 'sense': rs += value; break;
      // "All members' Score Support +X%" is one team aura, counted once.
      case 'score_support': support += value; break;
    }
  }
  // Each member rounds up on its own parameter, the level the reference
  // simulator uses and the only one that can produce per-member figures.
  const { base, count } = state;
  let total = state.memberPower;
  for (let i = 0; i < count; i++) {
    const at = i * 3;
    // Integer increments, so grouping them per member cannot move a bit.
    let gain = 0;
    if (rp) gain += Math.ceil(base[at] * rp / 100);
    if (rt) gain += Math.ceil(base[at + 1] * rt / 100);
    if (rs) gain += Math.ceil(base[at + 2] * rs / 100);
    total += gain;
    if (perMember) perMember[i] = gain;
  }
  return [total, support];
}

export function expectedIndexOf(payload: OutfitPayload | null, state: MemberState): number {
  const [totalPower, leaderSupport] = leaderPowerAndSupport(payload, state);
  // Score Support has no standalone score: it only amplifies an active Score UP.
  const multiplier = state.activeScoreUp / 100
    * (1 + (state.staticSupport + leaderSupport + state.specialSupport) / 100);
  return totalPower * (1 + multiplier);
}
