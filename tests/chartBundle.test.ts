/**
 * The chart bundle's structural promises, checked against what ships.
 *
 * tools/sync_songs.py writes this bundle unattended, so the properties the
 * site relies on are asserted here too rather than only inside the tool: a
 * bundle that reaches the repository by any route still has to satisfy them
 * before a deploy can go out.
 *
 * Decoding is done with the engine's own `materialize`, so a block this
 * cannot read is a block the browser could not read either.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isProvisional, materialize, prepare } from '../src/engine/chartScore';
import type { ChartMeta } from '../src/engine/chartScore';

interface Bundle {
  charts: ChartMeta[];
  index: Record<string, [number, number, number]>;
}

const bundle: Bundle = JSON.parse(
  readFileSync(new URL('../public/data/charts.json', import.meta.url), 'utf8'));
const blob = new Uint8Array(
  readFileSync(new URL('../public/data/charts.bin', import.meta.url))).buffer;

/** The key's suffix is the difficulty's rank, not its level: m0321:4 is Expert Lv.30. */
const DIFFICULTY_INDEX: Record<string, number> = { easy: 1, normal: 2, hard: 3, expert: 4 };
const BYTES_PER_NOTE = 4;
const SPECIAL_BYTES = 20;

describe('chart bundle', () => {
  it('carries a usable catalogue', () => {
    expect(bundle.charts.length).toBeGreaterThan(700);
    expect(Object.keys(bundle.index).length).toBe(bundle.charts.length);
  });

  it('has no duplicate chart key, and no song with the same difficulty twice', () => {
    const keys = bundle.charts.map((chart) => chart.key);
    expect(new Set(keys).size).toBe(keys.length);
    const pairs = bundle.charts.map((chart) => `${chart.musicId}/${chart.difficulty}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('pairs every chart with a timeline, and every timeline with a chart', () => {
    expect(new Set(Object.keys(bundle.index))).toEqual(
      new Set(bundle.charts.map((chart) => chart.key)));
  });

  it('encodes musicId and difficulty in every key', () => {
    for (const chart of bundle.charts) {
      const [musicId, suffix] = chart.key.split(':');
      expect(musicId, chart.key).toBe(chart.musicId);
      expect(Number(suffix), chart.key)
        .toBe(DIFFICULTY_INDEX[String(chart.difficulty).toLowerCase()]);
    }
  });

  it('gives every chart the metadata the song pages read', () => {
    for (const chart of bundle.charts) {
      expect(chart.title, chart.key).toBeTruthy();
      expect(chart.difficulty, chart.key).toBeTruthy();
      expect(chart.difficultyLevel, chart.key).toBeGreaterThan(0);
      expect(chart.fullComboNoteCount, chart.key).toBeGreaterThan(0);
      expect(chart.playingSeconds, chart.key).toBeGreaterThan(0);
      // Without a divisor the engine silently falls back to a local estimate,
      // which would make one song's score incomparable with the rest.
      expect(chart.scoreRatioEstimated, chart.key).toBeGreaterThan(0);
    }
  });

  it('keeps every timeline inside charts.bin and decodable', () => {
    for (const chart of bundle.charts) {
      const [offset, count, lastTime] = bundle.index[chart.key];
      expect(count, chart.key).toBe(chart.fullComboNoteCount);
      expect(offset, chart.key).toBeGreaterThanOrEqual(0);
      expect(offset + count * BYTES_PER_NOTE + SPECIAL_BYTES, chart.key)
        .toBeLessThanOrEqual(blob.byteLength);

      const timeline = materialize(blob, offset, count);
      expect(timeline.times.length, chart.key).toBe(count);
      // The index's third field is the chart's end, and the notes have to
      // agree with it or the timeline drawing is reading a different chart.
      expect(Math.round(timeline.times[count - 1] * 1000), chart.key).toBe(lastTime);
      expect(timeline.specialTimes.length, chart.key).toBe(5);
      for (let i = 1; i < count; i++) {
        expect(timeline.times[i], `${chart.key} note ${i}`)
          .toBeGreaterThanOrEqual(timeline.times[i - 1]);
      }
    }
  });

  it('prepares every chart into finite, positive scoring weight', () => {
    for (const chart of bundle.charts) {
      const [offset, count] = bundle.index[chart.key];
      const prepared = prepare(chart, materialize(blob, offset, count));
      const total = prepared.midPrefix[count] + prepared.normalPrefix[count];
      expect(Number.isFinite(total), chart.key).toBe(true);
      expect(total, chart.key).toBeGreaterThan(0);
      expect(prepared.scoreRatio, chart.key).toBeGreaterThan(0);
      expect(prepared.ratioSource, chart.key)
        .toBe('Hololive Dreams Lab estimated chart ratio');
    }
  });

  it('states every chart\'s provenance rather than leaving it to be guessed', () => {
    for (const chart of bundle.charts) {
      expect(['exact', 'provisional'], chart.key).toContain(chart.provenance);
    }
  });

  it('flags provisional charts to the UI and leaves exact ones unmarked', () => {
    // isProvisional is what both song surfaces render their notice from, so a
    // chart that is provisional in the data must be provisional to them.
    for (const chart of bundle.charts) {
      expect(isProvisional(chart), chart.key).toBe(chart.provenance === 'provisional');
    }
    // A bundle written before the field existed came wholly from the pack.
    expect(isProvisional({ key: 'legacy' })).toBe(false);
  });

  it('keeps the catalogue overwhelmingly exact', () => {
    // Provisional data is meant to be a short-lived bridge until Holodori
    // publishes a pack; if most of the catalogue were provisional something
    // has gone wrong with the upgrade path rather than with one song.
    const provisional = bundle.charts.filter((chart) => isProvisional(chart));
    expect(provisional.length).toBeLessThan(bundle.charts.length / 4);
  });

  it('leaves no timeline byte unclaimed', () => {
    // Every chart is appended, never rewritten in place, so the blocks should
    // tile the file exactly; a gap means a chart was dropped without its
    // bytes being reclaimed, and an overlap means two charts share notes.
    const blocks = bundle.charts
      .map((chart) => {
        const [offset, count] = bundle.index[chart.key];
        return { offset, end: offset + count * BYTES_PER_NOTE + SPECIAL_BYTES };
      })
      .sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    for (const block of blocks) {
      expect(block.offset).toBe(cursor);
      cursor = block.end;
    }
    expect(cursor).toBe(blob.byteLength);
  });
});
