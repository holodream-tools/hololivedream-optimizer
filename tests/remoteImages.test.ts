/**
 * The card artwork mapping, and the order ImageSource offers its tiers in.
 *
 * The mapping is written by tools/export_remote_images.py in CI, so what is
 * worth pinning here is not how it was produced but what the site relies on:
 * that it agrees with the artwork the build already ships (the one set of
 * URLs known to be correct), that it covers the cards the local manifest
 * cannot, and that a card's OWN picture is always preferred to its member's
 * portrait.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ImageSource } from '../src/lib/images';
import type { ArtManifest, PortraitManifest, RemoteArtManifest } from '../src/lib/images';
import type { CardBundle } from '../src/engine/types';

const read = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'));

const art = read<ArtManifest>('images.json');
const remote = read<RemoteArtManifest>('remote-images.json');
const portraits = read<PortraitManifest>('portraits.json');
const bundle = read<CardBundle>('cards.json');

const source = new ImageSource(art, remote, portraits, '/');

/** The filename identifies the picture; the ?v= cache-buster does not. */
function fileOf(url: string): string {
  return url.split('/').pop()!.split('?')[0];
}

describe('remote-images.json', () => {
  it('maps at least every card the bundled snapshot knows about', () => {
    const mapped = Object.keys(remote.cards);
    expect(mapped.length).toBeGreaterThanOrEqual(bundle.cards.length);
    for (const card of bundle.cards) {
      expect(remote.cards[card.id], `no artwork mapped for ${card.id}`).toBeTruthy();
    }
  });

  it('agrees with the build-time manifest on every card that has both', () => {
    // images.json is written from the desktop app's own cache, so where the
    // two overlap they are two independent routes to the same picture. A
    // disagreement means the CI resolver picked up the wrong card.
    const disagreements: string[] = [];
    for (const [cardId, entry] of Object.entries(art.cards)) {
      const mapped = remote.cards[cardId];
      if (mapped && fileOf(mapped) !== fileOf(entry.sourceUrl)) {
        disagreements.push(`${cardId}: ${fileOf(entry.sourceUrl)} vs ${fileOf(mapped)}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('covers the cards the build-time manifest misses, costume variants included', () => {
    const extra = Object.keys(remote.cards).filter((cardId) => !art.cards[cardId]);
    // The point of the file: it reaches cards the last export could not, and
    // a costume variant is the case no id-derived guess can reach at all.
    expect(extra.length).toBeGreaterThan(0);
    expect(extra.some((cardId) => cardId.includes('_swim_'))).toBe(true);
  });

  it('points every entry at a card picture on the attributed host', () => {
    for (const [cardId, url] of Object.entries(remote.cards)) {
      expect(url, cardId).toMatch(/^https:\/\/www\.horodori\.com\/images\/cards\//);
    }
  });
});

describe('ImageSource tier order', () => {
  const [withLocal] = Object.keys(art.cards);
  const [withoutLocal] = Object.keys(remote.cards).filter((cardId) => !art.cards[cardId]);

  it('has both a card that predates the build and one that does not', () => {
    expect(withLocal).toBeTruthy();
    expect(withoutLocal).toBeTruthy();
  });

  it('serves the mapped artwork for a card the build shipped no thumbnail for', () => {
    // The regression this file exists for: such a card used to fall straight
    // through to its member's portrait.
    expect(source.url(withoutLocal)).toBeUndefined();
    expect(source.remoteUrl(withoutLocal)).toBe(remote.cards[withoutLocal]);
    expect(source.remoteUrl(withoutLocal)).not.toBe(source.portrait(withoutLocal));
  });

  it('still prefers the build-time thumbnail where there is one', () => {
    expect(source.url(withLocal)).toBe(art.cards[withLocal].sourceUrl);
  });

  it('keeps the id-derived guess as a backstop that is right only for base cards', () => {
    // Documented as a fallback rather than the plan; this is what "wrong for
    // costume variants" actually means, and why the mapping had to exist.
    const swim = Object.keys(remote.cards).find((cardId) => cardId.includes('_swim_'))!;
    expect(fileOf(source.guessedArtUrl(swim))).not.toBe(fileOf(remote.cards[swim]));

    const base = Object.keys(remote.cards)
      .find((cardId) => fileOf(source.guessedArtUrl(cardId)) === fileOf(remote.cards[cardId]));
    expect(base, 'the guess should still be right for some base card').toBeTruthy();
  });

  it('offers nothing at all when the artwork layer is switched off', () => {
    const off = new ImageSource(art, remote, portraits, '/', false);
    expect(off.url(withLocal)).toBeUndefined();
    expect(off.remoteUrl(withLocal)).toBeUndefined();
    expect(off.portrait(withLocal)).toBeUndefined();
  });
});
