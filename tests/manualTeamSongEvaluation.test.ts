/**
 * ManualTeamPage's song evaluation ("自選隊伍" -> 指定歌曲評估).
 *
 * The feature is UI wiring around `bestOrder` -- the same call 歌曲／順序's
 * "指定隊伍" mode makes -- so these are the invariants that page's own
 * behaviour promises: a fixed five-member team keeps exactly those five
 * members whichever song is chosen (only the standing ORDER is searched),
 * and the resulting score is genuinely per-song, not a static number that
 * happens to be redrawn.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bestOrder } from '../src/engine/compare';
import { materialize, prepare } from '../src/engine/chartScore';
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

/** Five distinct talents, exactly like a player's manual pick: five card ids. */
const team: number[] = [];
const talents = new Set<string>();
for (let i = 0; i < facts.length && team.length < 5; i++) {
  if (!talents.has(facts[i].talent)) { talents.add(facts[i].talent); team.push(i); }
}

function prepareChart(key: string) {
  const meta = chartMeta.charts.find((row) => row.key === key)!;
  const [offset, count] = chartMeta.index[key];
  return prepare(meta, materialize(chartBlob, offset, count));
}

// Two distinct charts, so a per-song difference in score is not a coincidence
// of only ever having tried one chart.
const [chartA, chartB] = chartMeta.charts
  .filter((row) => row.difficulty === 'Expert')
  .slice(0, 2)
  .map((row) => row.key);

describe('manual team song evaluation', () => {
  it('has two distinct charts and a five-distinct-talent team to work with', () => {
    expect(team).toHaveLength(5);
    expect(chartA).toBeTruthy();
    expect(chartB).toBeTruthy();
    expect(chartA).not.toBe(chartB);
  });

  it('keeps exactly the five picked members, whichever song is chosen', () => {
    const preparedA = prepareChart(chartA);
    const preparedB = prepareChart(chartB);
    const resultA = bestOrder(facts, team, payload, preparedA);
    const resultB = bestOrder(facts, team, payload, preparedB);

    // The standing order is a permutation of the same five card indices --
    // never a different roster -- for both songs.
    expect(new Set(resultA.order)).toEqual(new Set(team));
    expect(new Set(resultB.order)).toEqual(new Set(team));
  });

  it('produces a genuinely per-song score, not the same number redrawn', () => {
    const preparedA = prepareChart(chartA);
    const preparedB = prepareChart(chartB);
    const resultA = bestOrder(facts, team, payload, preparedA);
    const resultB = bestOrder(facts, team, payload, preparedB);

    // Different charts have different note timing and length, so the same
    // fixed team scores differently on each -- if this ever collapsed to one
    // shared number, the evaluation would not actually be reading the chart.
    expect(resultA.score).not.toBe(resultB.score);
    expect(resultA.score).toBeGreaterThan(0);
    expect(resultB.score).toBeGreaterThan(0);
  });

  it('re-optimising the standing order never beats the best of all 120 permutations', () => {
    const prepared = prepareChart(chartA);
    const result = bestOrder(facts, team, payload, prepared);
    // best.worst is the score of the worst of the 120 permutations tried --
    // the same fixed five members, just badly arranged -- so it can never
    // exceed the best one found for the exact same roster.
    expect(result.score).toBeGreaterThanOrEqual(result.worst);
  });
});
