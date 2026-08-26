/**
 * The browser-side reshape must produce the same bundle the build-time export
 * does, or a refreshed card would score differently from a bundled one.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeUpstream } from '../src/lib/upstream';
import type { CardBundle } from '../src/engine/types';

const bundled: CardBundle = JSON.parse(readFileSync(new URL('../public/data/cards.json', import.meta.url), 'utf8'));
const upstream = JSON.parse(readFileSync(new URL('./fixtures/upstream_cards.json', import.meta.url), 'utf8'));

describe('upstream reshape parity with the build-time export', () => {
  const rebuilt = normalizeUpstream(upstream);

  it('produces the same cards, in the same order', () => {
    expect(rebuilt.cards.map((card) => card.id)).toEqual(bundled.cards.map((card) => card.id));
  });

  it('produces the same leader outfits', () => {
    expect(rebuilt.leaders.map((row) => row.id)).toEqual(bundled.leaders.map((row) => row.id));
  });

  it('reproduces every card field the engine reads', () => {
    for (const [index, card] of rebuilt.cards.entries()) {
      const reference = bundled.cards[index];
      expect(card, card.id).toEqual(reference);
    }
  });

  it('reproduces every outfit payload', () => {
    for (const [index, leader] of rebuilt.leaders.entries()) {
      expect(leader, leader.id).toEqual(bundled.leaders[index]);
    }
  });

  it('treats an empty or malformed payload as no data rather than an empty roster', () => {
    expect(normalizeUpstream({}).cards).toHaveLength(0);
    expect(normalizeUpstream({ cards: [{ id: 'x' }] }).cards).toHaveLength(0);
    expect(normalizeUpstream({ cards: [{ id: 'x', character: 'y', potential_data: [] }] }).cards).toHaveLength(0);
  });
});
