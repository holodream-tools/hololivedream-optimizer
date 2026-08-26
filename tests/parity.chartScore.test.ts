/**
 * Chart scoring parity.
 *
 * Unlike overallScore, this is NOT claimed to be bit-identical: the segmented
 * form sums notes in a different association order, so the final floor() can
 * differ by one point. The test measures the real rate instead of assuming it,
 * and fails outright if any case drifts by more than a single point.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { materialize, prepare, projectedScore } from '../src/engine/chartScore';
import { cardFacts, outfitTable } from '../src/engine/precompute';
import { makeMemberState, memberPart } from '../src/engine/overallScore';
import type { CardBundle } from '../src/engine/types';

interface Case {
  chartKey: string; noteCount: number; cardIds: string[]; leaderId: string;
  projectedScore: number; totalPower: number; perfectNoteScore: number;
}
interface ChartsBundle {
  charts: Array<{ key: string; scoreRatioEstimated?: number | null }>;
  index: Record<string, [number, number, number]>;
}

const dataUrl = (name: string) => new URL(`../public/data/${name}`, import.meta.url);
const bundle: CardBundle = JSON.parse(readFileSync(dataUrl('cards.json'), 'utf8'));
const chartsBundle: ChartsBundle = JSON.parse(readFileSync(dataUrl('charts.json'), 'utf8'));
const blobBytes = readFileSync(dataUrl('charts.bin'));
const blob = blobBytes.buffer.slice(blobBytes.byteOffset, blobBytes.byteOffset + blobBytes.byteLength);
const cases: Case[] = JSON.parse(readFileSync(new URL('./fixtures/chart_score.json', import.meta.url), 'utf8'));

const facts = cardFacts(bundle.cards, bundle.cards.map((c) => c.maxBloom));
const outfits = outfitTable(bundle.leaders, bundle.leaders.map((l) => l.maxBloom));
const cardIndex = new Map(bundle.cards.map((c, i) => [c.id, i]));
const leaderIndex = new Map(bundle.leaders.map((l, i) => [l.id, i]));
const chartMeta = new Map(chartsBundle.charts.map((c) => [c.key, c]));

describe('chartScore parity with the Python engine', () => {
  it('decodes the packed chart to the expected note count', () => {
    for (const testCase of cases.slice(0, 8)) {
      const [offset, count] = chartsBundle.index[testCase.chartKey];
      const timeline = materialize(blob, offset, count);
      expect(timeline.times.length).toBe(testCase.noteCount);
      expect(timeline.specialTimes.length).toBe(5);
    }
  });

  it('matches every projected score to within one point, and reports the drift', () => {
    const state = makeMemberState();
    let exact = 0;
    const drifted: string[] = [];
    for (const testCase of cases) {
      const members = testCase.cardIds.map((id) => cardIndex.get(id)!);
      const [offset, count] = chartsBundle.index[testCase.chartKey];
      const prepared = prepare(chartMeta.get(testCase.chartKey)!, materialize(blob, offset, count));
      memberPart(facts, members, state);
      const payload = outfits.payloads[outfits.signatureOf[leaderIndex.get(testCase.leaderId)!]];
      const got = projectedScore(facts, members, payload, prepared, state);

      expect(got.totalPower).toBe(testCase.totalPower);
      expect(got.perfectNoteScore).toBe(testCase.perfectNoteScore);
      const delta = got.projectedScore - testCase.projectedScore;
      if (delta === 0) exact++;
      else drifted.push(`${testCase.chartKey} (${testCase.noteCount} notes): ${delta}`);
      expect(Math.abs(delta), `${testCase.chartKey}: ${got.projectedScore} vs ${testCase.projectedScore}`).toBeLessThanOrEqual(1);
    }
    console.log(`    chart parity: ${exact}/${cases.length} exact` + (drifted.length ? `, drift: ${drifted.join('; ')}` : ''));
    expect(exact / cases.length).toBeGreaterThan(0.95);
  });
});
