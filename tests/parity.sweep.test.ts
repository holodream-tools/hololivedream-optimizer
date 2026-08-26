/**
 * The sharded sweep must reproduce the Python reference Top-N exactly -- the
 * scores, the members, the leader, AND the order.
 *
 * The fixture deliberately contains 28 exact ties inside the Top-50, so any
 * mistake in the (value, -sequence) tie-break or in the combination indexing
 * shows up here rather than as a subtly different ranking in production.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { binomial, shardRanges, unrank } from '../src/engine/combinations';
import { cardFacts, outfitTable } from '../src/engine/precompute';
import { sweep } from '../src/engine/sweep';
import { TopN } from '../src/engine/topN';
import type { CardBundle } from '../src/engine/types';

interface TopFixture {
  cardIds: string[]; leaderIds: string[]; limit: number; exactTiesInTopN: number;
  top: Array<{ value: number; members: string[]; leaderId: string }>;
}

const bundle: CardBundle = JSON.parse(readFileSync(new URL('../public/data/cards.json', import.meta.url), 'utf8'));
const fixture: TopFixture = JSON.parse(readFileSync(new URL('./fixtures/top_n.json', import.meta.url), 'utf8'));

const cards = fixture.cardIds.map((id) => bundle.cards.find((c) => c.id === id)!);
const leaders = fixture.leaderIds.map((id) => bundle.leaders.find((l) => l.id === id)!);
const facts = cardFacts(cards, cards.map((c) => c.maxBloom));
const outfits = outfitTable(leaders, leaders.map((l) => l.maxBloom));
const total = binomial(cards.length, 5);

function runSharded(shards: number) {
  const merged = new TopN(fixture.limit);
  for (const [start, end] of shardRanges(total, shards)) {
    const result = sweep({ facts, outfits, limit: fixture.limit, range: { start, end } });
    merged.merge(result.top.ranked());
  }
  return merged.ranked().map((entry) => ({
    value: entry.value,
    members: Array.from(entry.members).map((i) => cards[i].id),
    leaderId: leaders[entry.leaderIndex].id,
  }));
}

describe('sweep parity with the Python optimizer', () => {
  it('unranks combinations the same way itertools.combinations enumerates them', () => {
    const out = new Int32Array(5);
    unrank(cards.length, 5, 0, out);
    expect(Array.from(out)).toEqual([0, 1, 2, 3, 4]);
    unrank(cards.length, 5, total - 1, out);
    const n = cards.length;
    expect(Array.from(out)).toEqual([n - 5, n - 4, n - 3, n - 2, n - 1]);
  });

  it('the fixture really does contain ties, so the tie-break is under test', () => {
    expect(fixture.exactTiesInTopN).toBeGreaterThan(0);
  });

  it('reproduces the reference Top-N exactly, single shard', () => {
    expect(runSharded(1)).toEqual(fixture.top);
  });

  it('gives the same Top-N however the work is sharded', () => {
    for (const shards of [2, 3, 4, 7, 12]) {
      expect(runSharded(shards), `shards=${shards}`).toEqual(fixture.top);
    }
  });
});
