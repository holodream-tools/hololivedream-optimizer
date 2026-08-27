/**
 * The timeline's job is to explain a score, so its every number and every bar
 * must come from the pass that produced that score. These tests pin the shared
 * provenance rather than the drawing: that the windows drawn are the windows
 * charged for, that the coverages beside them are the coverages counted, and
 * that the density strip sums back to the chart it slices.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bestOrder } from '../src/engine/compare';
import { chartDensity, materialize, prepare, projectedScore } from '../src/engine/chartScore';
import { cardFacts, outfitTable } from '../src/engine/precompute';
import { distinctFormations, rankSongResults, scoreCandidates } from '../src/engine/songOptimize';
import type { CardBundle } from '../src/engine/types';
import type { ChartMeta } from '../src/engine/chartScore';
import type { SongScored } from '../src/engine/songOptimize';

const bundle: CardBundle = JSON.parse(
  readFileSync(new URL('../public/data/cards.json', import.meta.url), 'utf8'));
const chartFile: { charts: ChartMeta[]; index: Record<string, [number, number, number]> } =
  JSON.parse(readFileSync(new URL('../public/data/charts.json', import.meta.url), 'utf8'));
const blob = new Uint8Array(
  readFileSync(new URL('../public/data/charts.bin', import.meta.url))).buffer;

const facts = cardFacts(bundle.cards, bundle.cards.map((card) => card.maxBloom));
const outfits = outfitTable(bundle.leaders, bundle.leaders.map((leader) => leader.maxBloom));
const payloadOf = (leaderIndex: number) => outfits.payloads[outfits.signatureOf[leaderIndex]];

// The busiest chart in the catalogue: the one where the three coverages and the
// two density series have the most room to disagree.
const meta = [...chartFile.charts.filter((row) => row.difficulty === 'Expert')]
  .sort((a, b) => (b.fullComboNoteCount ?? 0) - (a.fullComboNoteCount ?? 0))[0];
const [offset, noteCount] = chartFile.index[meta.key];
const prepared = prepare(meta, materialize(blob, offset, noteCount));

function formation(seed: number): number[] {
  const members: number[] = [];
  const used = new Set<string>();
  for (let i = seed; i < facts.length && members.length < 5; i++) {
    if (!used.has(facts[i].talent)) { used.add(facts[i].talent); members.push(i); }
  }
  return members;
}
const teams = [0, 6, 12, 18].map(formation).filter((row) => row.length === 5);
const candidates = distinctFormations(
  teams.map((members, index) => ({ value: 1000 - index, members, leaderIndex: index })));

function rankedTeams() {
  const scored: SongScored[] = [];
  scoreCandidates(facts, candidates, payloadOf, prepared, 0, candidates.length, scored);
  return rankSongResults(facts, scored, payloadOf, prepared, 10);
}

describe('timeline provenance', () => {
  it('draws the standing order the song optimisation actually chose', () => {
    for (const row of rankedTeams()) {
      // The timeline renders detail.members[i] against order[i]; if the detail
      // came from a different arrangement the picture would libel the score.
      const direct = bestOrder(facts, row.members, payloadOf(row.leaderIndex), prepared);
      expect(row.order).toEqual(direct.order);
      expect(row.detail.members).toHaveLength(row.order.length);
      expect(row.detail.members!.map((member) => member.slot))
        .toEqual(row.order.map((_, slot) => slot));
    }
  });

  it('hands out the same windows the scoring pass charged for', () => {
    const row = rankedTeams()[0];
    const scored = projectedScore(facts, row.order, payloadOf(row.leaderIndex), prepared,
      undefined, true);
    const drawn = row.detail.members!;
    expect(scored.members).toEqual(drawn);

    for (let slot = 0; slot < drawn.length; slot++) {
      const card = facts[row.order[slot]];
      const special = drawn[slot].specialWindow;
      // The Special sits at the chart's own slot time, for the card's duration.
      expect(special.start).toBe(prepared.specialTimes[slot]);
      expect(special.end - special.start).toBeCloseTo(card.specialDuration, 9);

      for (const window of drawn[slot].activeWindows) {
        expect(window.end - window.start).toBeCloseTo(card.activeDuration, 9);
        expect(window.probability).toBeGreaterThan(0);
        expect(window.probability).toBeLessThanOrEqual(1);
        expect(window.start).toBeLessThanOrEqual(prepared.lastTime);
      }
      // Checks fire every `interval` seconds, so the count follows from the chart.
      const expected = card.activeInterval > 0 && card.activeDuration > 0
        ? Math.floor(prepared.lastTime / card.activeInterval) : 0;
      expect(drawn[slot].activeWindows).toHaveLength(expected);
    }
  });

  it('reports coverages that match the windows it drew', () => {
    const drawn = rankedTeams()[0].detail.members!;
    const songSeconds = prepared.lastTime - prepared.times[0];
    for (const member of drawn) {
      const seconds = member.activeWindows
        .reduce((total, w) => total + (w.end - w.start) * w.probability, 0);
      expect(member.activeTimeCoverage).toBeCloseTo(Math.min(1, seconds / songSeconds), 9);
      expect(member.specialTimeCoverage).toBeCloseTo(
        Math.min(1, (member.specialWindow.end - member.specialWindow.start) / songSeconds), 9);
      // Three different questions, so on a chart with structure they differ.
      expect(member.activeNoteCoverage).not.toBe(member.activeScoreCoverage);
    }
  });

  it('switching to another ranked team switches every number with it', () => {
    const ranked = rankedTeams();
    expect(ranked.length).toBeGreaterThan(1);
    const [first, second] = ranked;
    expect(first.order).not.toEqual(second.order);
    expect(first.detail.members).not.toEqual(second.detail.members);
    // Each team's detail belongs to that team, not to the one drawn before it.
    for (const row of [first, second]) {
      const direct = bestOrder(facts, row.members, payloadOf(row.leaderIndex), prepared);
      expect(row.detail.members).toEqual(direct.detail.members);
    }
  });
});

describe('chartDensity', () => {
  const perfect = rankedTeams()[0].detail.perfectNoteScore;

  it('slices the whole chart and nothing but the chart', () => {
    const buckets = chartDensity(prepared, perfect, 60);
    expect(buckets).toHaveLength(60);
    expect(buckets.reduce((total, bucket) => total + bucket.notes, 0)).toBe(noteCount);
    expect(buckets[0].start).toBeCloseTo(prepared.times[0], 9);
    expect(buckets[buckets.length - 1].end).toBeCloseTo(prepared.lastTime, 9);
  });

  it('agrees with the prefix sums the scoring pass reads', () => {
    const buckets = chartDensity(prepared, perfect, 40);
    const midValue = Math.ceil(perfect * 0.1);
    const whole = midValue * prepared.midPrefix[noteCount]
      + perfect * prepared.normalPrefix[noteCount];
    const summed = buckets.reduce((total, bucket) => total + bucket.weight, 0);
    expect(summed).toBeCloseTo(whole, 6);
  });

  it('separates a busy stretch from a valuable one', () => {
    const buckets = chartDensity(prepared, perfect, 60).filter((bucket) => bucket.notes > 0);
    const peakNotes = Math.max(...buckets.map((b) => b.notes));
    const peakWeight = Math.max(...buckets.map((b) => b.weight));
    const byNotes = buckets.findIndex((b) => b.notes === peakNotes);
    const byWeight = buckets.findIndex((b) => b.weight === peakWeight);
    // Not required to differ on every chart, but the two series must not be
    // proportional -- that is the whole reason both are drawn.
    const ratios = buckets.map((b) => b.weight / b.notes);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeGreaterThan(0);
    expect(byNotes).toBeGreaterThanOrEqual(0);
    expect(byWeight).toBeGreaterThanOrEqual(0);
  });

  it('returns nothing rather than throwing when there is nothing to draw', () => {
    expect(chartDensity(prepared, perfect, 0)).toEqual([]);
    const empty = prepare(meta, { times: new Float64Array(0), weights: new Float64Array(0), specialTimes: new Float64Array(5) });
    expect(chartDensity(empty, perfect, 20)).toEqual([]);
  });
});
