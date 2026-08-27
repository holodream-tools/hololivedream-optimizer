/**
 * The two song modes must not disagree about the same team on the same chart.
 *
 * They reach the answer by different routes. "指定隊伍" builds card facts from
 * just the five chosen cards, so member indices are 0..4. "歌曲最佳化" builds
 * them from the whole owned collection and carries the team as indices into
 * that, so the same five members arrive as, say, [3, 17, 9, 22, 5]. Both then
 * call the same bestOrder over all 120 arrangements.
 *
 * Everything a player reads must come out identical: the projected score, the
 * standing order, all three coverages, and every window the timeline draws.
 * The timeline is handed detail.members directly, so if these drift the picture
 * in one mode would contradict the picture in the other.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bestOrder } from '../src/engine/compare';
import { materialize, prepare } from '../src/engine/chartScore';
import { cardFacts, outfitTable } from '../src/engine/precompute';
import type { CardBundle, CardJson } from '../src/engine/types';
import type { ChartMeta } from '../src/engine/chartScore';

const bundle: CardBundle = JSON.parse(
  readFileSync(new URL('../public/data/cards.json', import.meta.url), 'utf8'));
const chartFile: { charts: ChartMeta[]; index: Record<string, [number, number, number]> } =
  JSON.parse(readFileSync(new URL('../public/data/charts.json', import.meta.url), 'utf8'));
const blob = new Uint8Array(
  readFileSync(new URL('../public/data/charts.bin', import.meta.url))).buffer;

const owned: CardJson[] = bundle.cards;
const ownedBlooms = owned.map((card) => card.maxBloom);
/** What the optimiser holds: facts over every owned card. */
const wideFacts = cardFacts(owned, ownedBlooms);
const outfits = outfitTable(bundle.leaders, bundle.leaders.map((leader) => leader.maxBloom));

/** Charts at opposite ends of length and density. */
const charts = ['KINGWORLD', 'YUKINO HANA', 'Renai Circulation']
  .map((title) => chartFile.charts.find((row) => row.title === title && row.difficulty === 'Expert'))
  .filter((row): row is ChartMeta => !!row)
  .map((meta) => {
    const [offset, count] = chartFile.index[meta.key];
    return { meta, prepared: prepare(meta, materialize(blob, offset, count)) };
  });

/** Five distinct talents starting from `seed`, as indices into `owned`. */
function formation(seed: number): number[] {
  const members: number[] = [];
  const used = new Set<string>();
  for (let i = seed; i < owned.length && members.length < 5; i++) {
    if (!used.has(owned[i].talent)) { used.add(owned[i].talent); members.push(i); }
  }
  return members;
}
const teams = [0, 9, 21, 34].map(formation).filter((row) => row.length === 5);

describe('指定隊伍 and 歌曲最佳化 agree', () => {
  it('has teams and charts to compare', () => {
    expect(teams.length).toBeGreaterThan(2);
    expect(charts.length).toBe(3);
  });

  for (const { meta, prepared } of charts) {
    it(`gives one answer for ${meta.title}`, () => {
      for (const [leaderIndex, memberIndices] of teams.map((t, i) => [i, t] as const)) {
        const payload = outfits.payloads[outfits.signatureOf[leaderIndex]];

        // 歌曲最佳化: the team as indices into the whole collection.
        const wide = bestOrder(wideFacts, memberIndices, payload, prepared);

        // 指定隊伍: facts rebuilt from only the five cards, indices 0..4.
        const picked = memberIndices.map((index) => owned[index]);
        const narrowFacts = cardFacts(picked, picked.map((card) => card.maxBloom));
        const narrow = bestOrder(narrowFacts, [0, 1, 2, 3, 4], payload, prepared);

        expect(narrow.score).toBe(wide.score);
        expect(narrow.worst).toBe(wide.worst);

        // The orders are expressed in different index spaces, so compare the
        // cards they name rather than the numbers.
        expect(narrow.order.map((i) => picked[i].id))
          .toEqual(wide.order.map((i) => owned[i].id));

        // Everything the timeline draws.
        expect(narrow.detail.members).toEqual(wide.detail.members);
        expect(narrow.detail.perfectNoteScore).toBe(wide.detail.perfectNoteScore);
        expect(narrow.detail.totalPower).toBe(wide.detail.totalPower);
        expect(narrow.detail.activeBonus).toBe(wide.detail.activeBonus);
      }
    });
  }

  it('draws the same windows and coverages member for member', () => {
    const { prepared } = charts[0];
    const memberIndices = teams[0];
    const payload = outfits.payloads[outfits.signatureOf[0]];
    const picked = memberIndices.map((index) => owned[index]);
    const narrowFacts = cardFacts(picked, picked.map((card) => card.maxBloom));

    const wide = bestOrder(wideFacts, memberIndices, payload, prepared);
    const narrow = bestOrder(narrowFacts, [0, 1, 2, 3, 4], payload, prepared);

    const a = wide.detail.members!, b = narrow.detail.members!;
    expect(a).toHaveLength(5);
    for (let slot = 0; slot < 5; slot++) {
      expect(b[slot].specialWindow).toEqual(a[slot].specialWindow);
      expect(b[slot].activeWindows).toEqual(a[slot].activeWindows);
      expect(b[slot].specialTimeCoverage).toBe(a[slot].specialTimeCoverage);
      expect(b[slot].specialNoteCoverage).toBe(a[slot].specialNoteCoverage);
      expect(b[slot].specialScoreCoverage).toBe(a[slot].specialScoreCoverage);
      expect(b[slot].activeTimeCoverage).toBe(a[slot].activeTimeCoverage);
      expect(b[slot].activeNoteCoverage).toBe(a[slot].activeNoteCoverage);
      expect(b[slot].activeScoreCoverage).toBe(a[slot].activeScoreCoverage);
    }
    // And the slot each member stands in is the same member in both.
    expect(narrow.order.map((i) => picked[i].name))
      .toEqual(wide.order.map((i) => owned[i].name));
  });
});
