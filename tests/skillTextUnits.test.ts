/**
 * Every percentage a skill description states carries its unit.
 *
 * Score Support used to print bare, on the assumption that the game words it
 * that way -- it does not, and `outfitText` had the assumption written in as
 * an explicit special case. It reaches the score through the same `/ 100` as
 * a stat bonus (see overallScore.expectedIndexOf and chartScore's per-note
 * lift), so it reads as a percentage everywhere else in the app and has to
 * here too.
 *
 * Driven off the real card data rather than hand-built skill objects, so the
 * shapes tested are the shapes that actually ship.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activeText, outfitText, passiveText, specialText } from '../src/ui/skillText';
import type { CardBundle } from '../src/engine/types';

const bundle: CardBundle = JSON.parse(
  readFileSync(new URL('../public/data/cards.json', import.meta.url), 'utf8'));

/** Every "+<number>" in a rendered sentence, with whatever follows it. */
function bareNumbers(text: string): string[] {
  return [...text.matchAll(/\+\d+(?:\.\d+)?(.?)/g)]
    .filter((match) => match[1] !== '%')
    .map((match) => match[0]);
}

const passives = bundle.cards
  .map((card) => passiveText(card.blooms[String(card.maxBloom)]?.support))
  .filter((text): text is string => !!text);
const specials = bundle.cards
  .map((card) => specialText(card.blooms[String(card.maxBloom)]?.special))
  .filter((text): text is string => !!text);
const actives = bundle.cards
  .map((card) => activeText(card.blooms[String(card.maxBloom)]?.active))
  .filter((text): text is string => !!text);
const outfits = bundle.leaders
  .map((leader) => outfitText(leader.outfits[String(leader.maxBloom)]))
  .filter((text): text is string => !!text);

describe('skill descriptions state their unit', () => {
  it('rendered something for every kind of skill in the catalogue', () => {
    expect(passives.length).toBeGreaterThan(0);
    expect(specials.length).toBeGreaterThan(0);
    expect(actives.length).toBeGreaterThan(0);
    expect(outfits.length).toBeGreaterThan(0);
  });

  it('leaves no "+N" without a % in any card skill', () => {
    for (const text of [...passives, ...specials, ...actives]) {
      expect(bareNumbers(text), text).toEqual([]);
    }
  });

  it('leaves no "+N" without a % in any Leader Outfit', () => {
    // The regression this file exists for: outfitText special-cased
    // score_support to print no unit at all.
    for (const text of outfits) {
      expect(bareNumbers(text), text).toEqual([]);
    }
  });

  it('puts the % on Score Support specifically, wherever it appears', () => {
    const supportLines = [...passives, ...specials, ...outfits]
      .filter((text) => text.includes('分數支援'));
    expect(supportLines.length).toBeGreaterThan(0);
    for (const text of supportLines) {
      expect(text, text).toMatch(/分數支援 \+\d+(\.\d+)?%/);
    }
  });

  it('never doubles the sign', () => {
    for (const text of [...passives, ...specials, ...actives, ...outfits]) {
      expect(text, text).not.toContain('%%');
    }
  });
});
