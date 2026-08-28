/**
 * An attribution that does not add up is worse than none: it invites the reader
 * to trust a breakdown of a number it cannot reconstruct. These tests pin the
 * identity itself -- the rows sum to the gap, the gap flips sign with the teams,
 * and two identical teams explain nothing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attributeChart, attributeGeneric } from '../src/engine/attribution';
import { bestOrder, genericView } from '../src/engine/compare';
import { materialize, prepare } from '../src/engine/chartScore';
import { cardFacts, outfitTable } from '../src/engine/precompute';
import type { CardBundle } from '../src/engine/types';
import type { ChartMeta } from '../src/engine/chartScore';

const bundle: CardBundle = JSON.parse(
  readFileSync(new URL('../public/data/cards.json', import.meta.url), 'utf8'));
const chartFile: { charts: ChartMeta[]; index: Record<string, [number, number, number]> } =
  JSON.parse(readFileSync(new URL('../public/data/charts.json', import.meta.url), 'utf8'));
const blob = new Uint8Array(
  readFileSync(new URL('../public/data/charts.bin', import.meta.url))).buffer;

const facts = cardFacts(bundle.cards, bundle.cards.map((card) => card.maxBloom));
const outfits = outfitTable(bundle.leaders, bundle.leaders.map((leader) => leader.maxBloom));
const payloadOf = (index: number) => outfits.payloads[outfits.signatureOf[index]];

const meta = chartFile.charts.find((row) => row.difficulty === 'Expert')!;
const [offset, count] = chartFile.index[meta.key];
const prepared = prepare(meta, materialize(blob, offset, count));

function formation(seed: number): number[] {
  const members: number[] = [];
  const used = new Set<string>();
  for (let i = seed; i < facts.length && members.length < 5; i++) {
    if (!used.has(facts[i].talent)) { used.add(facts[i].talent); members.push(i); }
  }
  return members;
}

/** Several unrelated pairings, so the identity is not pinned on one lucky case. */
const pairs = [[0, 7], [3, 15], [11, 22], [5, 30], [18, 2]]
  .map(([x, y]) => ({ a: formation(x), b: formation(y), aLeader: x % 20, bLeader: y % 20 }))
  .filter((pair) => pair.a.length === 5 && pair.b.length === 5);

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe('generic attribution', () => {
  it('has pairs to work with', () => expect(pairs.length).toBeGreaterThan(3));

  it('adds up to the gap it claims to explain', () => {
    for (const pair of pairs) {
      const a = genericView(facts, pair.a, payloadOf(pair.aLeader));
      const b = genericView(facts, pair.b, payloadOf(pair.bLeader));
      const report = attributeGeneric(a, b);

      // The identity holds in log space, exactly.
      expect(sum(report.rows.map((row) => row.log))).toBeCloseTo(report.logGap, 10);
      // And the rescaled rows sum to the number shown in the headline.
      expect(sum(report.rows.map((row) => row.percent))).toBeCloseTo(report.gap, 8);
      // The headline is the real ratio, not a log approximation of it.
      expect(report.gap).toBeCloseTo((a.index / b.index - 1) * 100, 9);
    }
  });

  it('flips every sign when the teams swap places', () => {
    const pair = pairs[0];
    const a = genericView(facts, pair.a, payloadOf(pair.aLeader));
    const b = genericView(facts, pair.b, payloadOf(pair.bLeader));
    const forward = attributeGeneric(a, b);
    const backward = attributeGeneric(b, a);

    expect(backward.logGap).toBeCloseTo(-forward.logGap, 12);
    for (const row of forward.rows) {
      const mirror = backward.rows.find((other) => other.label === row.label)!;
      expect(mirror.log).toBeCloseTo(-row.log, 12);
      expect(mirror.a).toBe(row.b);
      expect(mirror.b).toBe(row.a);
    }
  });

  it('explains nothing when the two teams are the same', () => {
    const view = genericView(facts, pairs[0].a, payloadOf(pairs[0].aLeader));
    const report = attributeGeneric(view, view);
    expect(report.gap).toBe(0);
    expect(report.logGap).toBe(0);
    for (const row of report.rows) {
      expect(row.log).toBe(0);
      expect(row.percent).toBe(0);
    }
  });

  it('separates SAR from the Active it inflates', () => {
    // A team whose Specials carry a Rate Up must show a non-zero SAR row
    // against one whose do not, and Active alone must not absorb it.
    const withSar = pairs.find((pair) =>
      genericView(facts, pair.a, payloadOf(pair.aLeader)).sarPoints > 0);
    expect(withSar).toBeTruthy();
    const a = genericView(facts, withSar!.a, payloadOf(withSar!.aLeader));
    expect(a.activeScoreUp).toBeGreaterThan(a.activeScoreUpNoSar);
  });

  it('orders the rows by how much they explain', () => {
    const pair = pairs[1];
    const report = attributeGeneric(
      genericView(facts, pair.a, payloadOf(pair.aLeader)),
      genericView(facts, pair.b, payloadOf(pair.bLeader)));
    for (let i = 1; i < report.rows.length; i++) {
      expect(Math.abs(report.rows[i - 1].percent))
        .toBeGreaterThanOrEqual(Math.abs(report.rows[i].percent));
    }
  });
});

describe('song attribution', () => {
  const sideOf = (members: number[], leader: number) => {
    const payload = payloadOf(leader);
    const best = bestOrder(facts, members, payload, prepared);
    return { view: genericView(facts, best.order, payload), detail: best.detail, score: best.score };
  };

  it('adds up to the song gap, rounding included', () => {
    for (const pair of pairs) {
      const a = sideOf(pair.a, pair.aLeader);
      const b = sideOf(pair.b, pair.bLeader);
      const report = attributeChart(a, b);

      expect(sum(report.rows.map((row) => row.log))).toBeCloseTo(report.logGap, 10);
      expect(sum(report.rows.map((row) => row.percent))).toBeCloseTo(report.gap, 8);
      expect(report.gap).toBeCloseTo((a.score / b.score - 1) * 100, 9);
    }
  });

  it('folds the quantisation into the power rows instead of listing it', () => {
    for (const pair of pairs) {
      const a = sideOf(pair.a, pair.aLeader);
      const b = sideOf(pair.b, pair.bLeader);
      const report = attributeChart(a, b);
      expect(report.rows.map((row) => row.label)).not.toContain('取整與捨去');

      // What the power rows would have been without the fold. The floors move
      // them by a rounding error, which is the whole point of not listing it.
      const powerMean = (a.view.totalPower - b.view.totalPower)
        / (Math.log(a.view.totalPower) - Math.log(b.view.totalPower));
      const raw = new Map([
        ['基礎能力', (a.view.basePower - b.view.basePower) / powerMean],
        ['被動技能能力加成', (a.view.passiveGain - b.view.passiveGain) / powerMean],
        ['隊長服裝能力加成', (a.view.outfitGain - b.view.outfitGain) / powerMean],
      ]);
      const scale = report.gap / report.logGap;
      let moved = 0;
      for (const [label, log] of raw) {
        const row = report.rows.find((other) => other.label === label)!;
        moved += Math.abs(row.percent - log * scale);
      }
      // floor() on a six-figure score cannot account for a percentage point.
      expect(moved).toBeLessThan(0.5);
    }
  });

  it('flips sign on swap and vanishes on identical teams', () => {
    const a = sideOf(pairs[0].a, pairs[0].aLeader);
    const b = sideOf(pairs[0].b, pairs[0].bLeader);
    const forward = attributeChart(a, b);
    const backward = attributeChart(b, a);
    expect(backward.logGap).toBeCloseTo(-forward.logGap, 12);
    for (const row of forward.rows) {
      const mirror = backward.rows.find((other) => other.label === row.label)!;
      expect(mirror.log).toBeCloseTo(-row.log, 12);
    }

    const same = attributeChart(a, a);
    expect(same.gap).toBe(0);
    for (const row of same.rows) expect(row.log).toBeCloseTo(0, 12);
  });

  it('reads the chart figures, not the generic ones', () => {
    const a = sideOf(pairs[0].a, pairs[0].aLeader);
    const b = sideOf(pairs[1].a, pairs[1].aLeader);
    const song = attributeChart(a, b);
    const generic = attributeGeneric(a.view, b.view);

    // The chart report is about the chart score; the generic one is about the
    // index. Same teams, different questions, so different answers.
    expect(song.aTotal).toBe(a.score);
    expect(generic.aTotal).toBe(a.view.index);
    expect(song.rows.map((row) => row.label))
      .toContain('本曲技能實際貢獻');
    expect(generic.rows.map((row) => row.label)).toContain('技能發動率加成（SAR）');
  });
});
