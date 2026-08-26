/**
 * Flatten the exported bundle into per-card facts at a chosen Bloom.
 *
 * Port of app/engine/precompute.py. The Python side resolves `selected_bloom`
 * once per search; here the player picks a Bloom per card, so the caller passes
 * the chosen Bloom and this rebuilds the table.
 */
import type { CardBundle, CardFacts, CardJson, LeaderJson, OutfitPayload, OutfitTable, SkillJson } from './types';

/** The reference song length the chart-agnostic model averages Special over. */
export const GENERIC_SONG_SECONDS = 192.0;

function num(skill: SkillJson | null, key: string): number {
  if (!skill) return 0;
  const value = skill[key];
  return typeof value === 'number' ? value : value == null ? 0 : Number(value);
}

export function cardFacts(cards: CardJson[], blooms: number[]): CardFacts[] {
  const facts: CardFacts[] = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const bloom = card.blooms[String(blooms[i])] ?? card.blooms[String(card.maxBloom)];
    const passive = bloom?.support ?? null;
    const active = bloom?.active ?? null;
    const special = bloom?.special ?? null;
    const duration = num(special, 'duration');
    const performance = bloom?.performance ?? 0;
    const technique = bloom?.technique ?? 0;
    const sense = bloom?.sense ?? 0;
    const rateUp = special?.skill_rate_up;
    facts.push({
      id: card.id,
      talent: card.talent,
      performance, technique, sense,
      total: performance + technique + sense,
      type: card.type.toLowerCase(),
      generation: card.generation,
      passiveEffect: (passive?.effect_type as string) ?? null,
      passiveValue: num(passive, 'value'),
      passiveTarget: passive?.target ?? null,
      passiveStat: (passive?.stat as string) ?? null,
      passiveCondition: (passive?.condition as never) ?? null,
      activePresent: !!active && Object.keys(active).length > 0,
      activeProbability: num(active, 'activation_probability_permil') / 1000,
      activeInterval: num(active, 'interval'),
      activeDuration: num(active, 'duration'),
      activeScoreUp: num(active, 'score_up'),
      activeCondition: active?.condition ?? null,
      activeConditionalScoreUp: active?.conditional_score_up == null
        ? null : Number(active.conditional_score_up),
      specialSupportAverage: num(special, 'score_support') * duration / GENERIC_SONG_SECONDS,
      specialSarAverage: rateUp ? Number(rateUp) * duration / GENERIC_SONG_SECONDS : 0,
      specialDuration: duration,
      specialScoreSupport: num(special, 'score_support'),
      specialSkillRateUp: num(special, 'skill_rate_up'),
      specialRateCondition: special?.skill_rate_condition ?? null,
    });
  }
  return facts;
}

/**
 * Collapse identical outfit payloads to one entry WITHOUT dropping any leader.
 *
 * Several leaders ship byte-identical payloads and always score a given team the
 * same. Sharing the computed value is safe; removing the duplicate leaders is
 * not, because the Top-N tie-break keeps the earliest enumerated entry and every
 * leader must keep its own sequence slot.
 */
export function outfitTable(leaders: LeaderJson[], blooms: number[]): OutfitTable {
  const ids = new Map<string, number>();
  const payloads: (OutfitPayload | null)[] = [];
  const signatureOf = new Int32Array(leaders.length);
  for (let i = 0; i < leaders.length; i++) {
    const leader = leaders[i];
    const payload = leader.outfits[String(blooms[i])] ?? leader.outfits[String(leader.maxBloom)] ?? null;
    const signature = JSON.stringify(payload ?? null);
    let id = ids.get(signature);
    if (id === undefined) { id = payloads.length; ids.set(signature, id); payloads.push(payload); }
    signatureOf[i] = id;
  }
  return { signatureOf, payloads, count: leaders.length };
}

export function bundleBlooms(bundle: CardBundle): { cardBlooms: number[]; leaderBlooms: number[] } {
  return {
    cardBlooms: bundle.cards.map((c) => c.maxBloom),
    leaderBlooms: bundle.leaders.map((l) => l.maxBloom),
  };
}
