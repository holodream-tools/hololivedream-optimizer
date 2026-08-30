/**
 * Chart scoring parity.
 *
 * Unlike overallScore, this is NOT claimed to be bit-identical: the segmented
 * form sums notes in a different association order, so the final floor() can
 * differ by one point. The test measures the real rate instead of assuming it,
 * and fails outright if any case drifts by more than a single point.
 *
 * THE FIXTURE IS ONE MODEL BEHIND. It was exported from the Python reference
 * while that engine charged the Combo Bonus a second time on top of the one the
 * packed note already carries -- see chartWeightModel.test.ts for what the pack
 * actually holds, and noteScale() for why. The Python checkout is not on this
 * machine, so the fixture cannot be regenerated here.
 *
 * Rather than delete the only independent anchor the port has, the cases are
 * replayed against the model that produced them: the Combo Bonus is folded into
 * the weights before `prepare` sees them, which reproduces the old scorer
 * exactly. Every other part of the pipeline -- power, Special windows, Active
 * windows, E[max], Score Support, the segment walk -- is still pinned to
 * Python, so a real port bug still fails this test.
 *
 * TODO(combo-bonus): retire this compatibility shim.
 *   1. tests/fixtures/chart_score.json holds scores from the wrong model: the
 *      Python reference charged the Combo Bonus twice, so every case with 100
 *      or more notes is too high, by 0.5% to 6.9%.
 *   2. `withComboFoldedIn` below exists only to keep those numbers usable, so
 *      the rest of the scoring path stays pinned to Python meanwhile. It is not
 *      a statement about how a chart should be scored.
 *   3. Once the Python checkout is reachable: drop the second Combo Bonus in
 *      app/engine/chart_score.py, regenerate the fixture with
 *      tools/export_chart_truth.py, then delete `withComboFoldedIn` and this
 *      TODO and call `prepare` on the timeline directly again.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { materialize, prepare, projectedScore } from '../src/engine/chartScore';
import { cardFacts, outfitTable } from '../src/engine/precompute';
import { makeMemberState, memberPart } from '../src/engine/overallScore';
import type { CardBundle } from '../src/engine/types';
import type { ChartTimeline } from '../src/engine/chartScore';

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

/** The published Combo Bonus, as the fixture's generation applied it. */
function comboBonus(combo: number): number {
  if (combo >= 1000) return 0.1;
  if (combo >= 100) return Math.floor(combo / 100) / 100;
  return 0;
}

/**
 * The fixture's scoring model, rebuilt from the shipped one. TEMPORARY -- see
 * TODO(combo-bonus) at the top of this file; delete once the fixture is
 * regenerated from a corrected Python reference.
 *
 * `prepare` divides the base back out of each weight and keeps whatever
 * multipliers the pack put there. Scaling the weight by the Combo Bonus first
 * therefore charges it twice, which is what the fixture recorded. The mid
 * threshold survives the scaling: a mid note tops out at 110 * 1.1 = 121, still
 * under 200, and a normal note starts at 1000.
 */
function withComboFoldedIn(timeline: ChartTimeline): ChartTimeline {
  const weights = new Float64Array(timeline.weights.length);
  for (let i = 0; i < weights.length; i++) {
    weights[i] = timeline.weights[i] * (1 + comboBonus(i + 1));
  }
  return { times: timeline.times, weights, specialTimes: timeline.specialTimes };
}

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
      const prepared = prepare(chartMeta.get(testCase.chartKey)!,
        withComboFoldedIn(materialize(blob, offset, count)));
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
