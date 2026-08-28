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
      // Everything the engine reads must match. cardNumber is the one field
      // the build-time export cannot carry -- its source, the Python project's
      // database, does not keep holodori_id -- so it is compared separately
      // below rather than silently dropped from the comparison.
      const { cardNumber, ...engineFields } = card;
      void cardNumber;
      expect(engineFields, card.id).toEqual(reference);
    }
  });

  it('adds the card number, and only that, on the upstream path', () => {
    for (const card of rebuilt.cards) {
      expect(card.cardNumber, card.id).toBeGreaterThan(0);
    }
    // Nothing the snapshot carries is missing from the reshape, and nothing new
    // appears beyond this one field.
    const extra = new Set(Object.keys(rebuilt.cards[0]));
    for (const key of Object.keys(bundled.cards[0])) extra.delete(key);
    expect([...extra]).toEqual(['cardNumber']);
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
