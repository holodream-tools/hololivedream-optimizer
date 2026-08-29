/**
 * Card artwork with the fallback chain a live-refreshed card needs.
 *
 * Four tiers, best first: the local thumbnail the build shipped, then the
 * card's real picture from the mapping CI keeps current, then a guess from
 * the card id (right only for base cards), and only once every attempt at
 * THIS CARD has failed does it settle for the member's portrait, and finally
 * the typographic panel every caller already had.
 *
 * Walked at render time rather than resolved upfront because a URL can only
 * be proven wrong by asking for it: each tier is rendered as an `<img>` and
 * `onError` advances to the next.
 */
import { useState } from 'react';
import type { ImageSource } from '../lib/images';

export interface CardArtProps {
  images: ImageSource | null | undefined;
  cardId: string;
  width: number;
  height: number;
  className?: string;
  noArtClassName: string;
  noArtLabel: string;
}

export function CardArt({ images, cardId, width, height, className, noArtClassName, noArtLabel }: CardArtProps) {
  const [tier, setTier] = useState(0);
  // Reset during render rather than in an effect: an id swapped into an
  // already-mounted slot (a manual-team pick, a pinned card) must not keep
  // replaying the previous card's failed tiers.
  const [seenId, setSeenId] = useState(cardId);
  if (cardId !== seenId) { setSeenId(cardId); setTier(0); }

  // Deduplicated: the local manifest and the mapping usually agree on a card
  // that predates the last deploy, and retrying the identical URL after it
  // failed would only stall on the same error. `guessedArtUrl` answers for any
  // id at all, so it is asked only while the artwork layer is on -- otherwise
  // switching that layer off would still leave a guess on screen.
  const candidates = [
    images?.url(cardId),
    images?.remoteUrl(cardId),
    images?.enabled ? images.guessedArtUrl(cardId) : undefined,
    images?.portraitAt(cardId, width),
  ].filter((url, index, all): url is string => !!url && all.indexOf(url) === index);
  const src = candidates[tier];

  if (!src) return <span className={noArtClassName}>{noArtLabel}</span>;

  return (
    <img src={src} alt="" loading="lazy" width={width} height={height} className={className}
         onError={() => setTier((current) => current + 1)} />
  );
}
