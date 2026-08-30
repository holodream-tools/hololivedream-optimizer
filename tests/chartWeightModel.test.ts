/**
 * What a packed note weight means, checked against the model it was packed
 * under rather than against our own scorer.
 *
 * The pack is Holodori's, and both Holodori's reader and Hololive Dreams Lab's
 * simulator charge the Combo Bonus once, on the note. This file re-derives the
 * per-note score from that published model and requires `prepare` to agree.
 *
 * It exists because the engine once charged the Combo Bonus a second time and
 * every test still passed: the parity fixture came from a reference that made
 * the same mistake, and everything else asserted relationships rather than
 * values. A model this cheap to state deserves a test that states it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { materialize, prepare } from '../src/engine/chartScore';
import type { ChartMeta } from '../src/engine/chartScore';

interface ChartsBundle {
  charts: ChartMeta[];
  index: Record<string, [number, number, number]>;
}

const dataUrl = (name: string) => new URL(`../public/data/${name}`, import.meta.url);
const chartsBundle: ChartsBundle = JSON.parse(readFileSync(dataUrl('charts.json'), 'utf8'));
const blobBytes = readFileSync(dataUrl('charts.bin'));
const blob = blobBytes.buffer.slice(blobBytes.byteOffset,
  blobBytes.byteOffset + blobBytes.byteLength);

/** Published Combo Bonus: +1% from 100 Combo, +1% per 100 after, +10% cap. */
function comboBonus(combo: number): number {
  if (combo >= 1000) return 0.1;
  if (combo >= 100) return Math.floor(combo / 100) / 100;
  return 0;
}

/** A stored uint16, before materialize halves it. */
const stored = (base: number, combo: number, flick: number) =>
  Math.round(base * (1 + comboBonus(combo)) * flick * 2);

describe('packed chart weights', () => {
  it('are base x Combo Bonus x Flick, and nothing else', () => {
    let mid = 0, normal = 0, flick = 0;
    const unexplained: string[] = [];
    for (const chart of chartsBundle.charts) {
      const [offset, count] = chartsBundle.index[chart.key];
      const timeline = materialize(blob, offset, count);
      for (let i = 0; i < count; i++) {
        // materialize halves the stored value; compare on the stored scale so
        // the expected values stay integers.
        const raw = Math.round(timeline.weights[i] * 2);
        if (raw === stored(100, i + 1, 1)) mid++;
        else if (raw === stored(1000, i + 1, 1)) normal++;
        else if (raw === stored(1000, i + 1, 1.05)) flick++;
        else if (unexplained.length < 5) unexplained.push(`${chart.key}#${i}: ${raw}`);
      }
    }
    expect(unexplained, unexplained.join(', ')).toEqual([]);
    // The split itself is not the claim, but a bundle with no holds or no
    // flicks would pass the loop above while proving nothing.
    expect(mid).toBeGreaterThan(0);
    expect(normal).toBeGreaterThan(0);
    expect(flick).toBeGreaterThan(0);
  });

  it('carry a Combo Bonus keyed to the note index, holds included', () => {
    // Read the bonus off mid notes only. A mid note has no Flick variant, so
    // its multiplier is the Combo Bonus and nothing else -- on a normal note
    // 1.05 is a Flick and 1.05 is also the bonus at 500 Combo, and the two
    // cannot be told apart without assuming the answer.
    //
    // Reading it against `i + 1` is the point of the test: it pins the bonus to
    // the position of the note in the whole chart, hold ticks counted, which is
    // what makes it the Combo Bonus rather than some other per-note scaling.
    let checked = 0;
    let grew = 0;
    for (const chart of chartsBundle.charts) {
      const [offset, count] = chartsBundle.index[chart.key];
      const timeline = materialize(blob, offset, count);
      let first: number | null = null;
      let last = 0;
      for (let i = 0; i < count; i++) {
        const weight = timeline.weights[i];
        if (weight >= 200) continue;
        const bonus = Math.round((weight / 100 - 1) * 100);
        expect(bonus, `${chart.key}#${i}`).toBe(Math.round(comboBonus(i + 1) * 100));
        if (first === null) first = bonus;
        last = bonus;
        checked++;
      }
      if (first !== null && last > first) grew++;
    }
    expect(checked).toBeGreaterThan(10000);
    // A pack that had left the bonus out would read 0 everywhere and still pass
    // the loop on a chart under 100 notes; most charts have to show it growing.
    expect(grew).toBeGreaterThan(300);
  });

  it('scores each note the way Hololive Dreams Lab does', () => {
    // The Lab's own per-note figure, with its rounding:
    //   (mid ? ceil(perfect * 0.1) : perfect) * (mid ? 1 : flick) * comboScale
    const PERFECT = 600;
    const MID = Math.ceil(PERFECT * 0.1);
    for (const chart of chartsBundle.charts) {
      const [offset, count] = chartsBundle.index[chart.key];
      const timeline = materialize(blob, offset, count);
      const prepared = prepare(chart, timeline);

      let lab = 0;
      for (let i = 0; i < count; i++) {
        const weight = timeline.weights[i];
        const isMid = weight < 200;
        const combo = 1 + comboBonus(i + 1);
        const flick = isMid ? 1 : (weight / 1000) / combo;
        lab += (isMid ? MID : PERFECT) * (isMid ? 1 : flick) * combo;
      }
      // The same total the scoring pass builds from the prefix sums.
      const ours = MID * prepared.midPrefix[count] + PERFECT * prepared.normalPrefix[count];
      expect(ours, chart.key).toBeCloseTo(lab, 6);
    }
  });
});
