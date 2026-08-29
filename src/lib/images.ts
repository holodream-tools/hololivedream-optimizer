/**
 * Card artwork, in four tiers with different lifetimes.
 *
 *   art      192x108 card thumbnails, shipped with the build. One per CARD,
 *            written from the desktop app's local cache, so a newly released
 *            card has none until someone runs tools/export_images.py again.
 *   remote   every card's real artwork URL, resolved in CI by
 *            tools/export_remote_images.py and refreshed on a schedule. Also
 *            one per CARD, but it does not need the desktop cache, so a card
 *            released since the last deploy is normally already in here --
 *            costume and event variants included, which no rule over the card
 *            id can derive.
 *   guessed  a last attempt at the card's own picture, derived from the id's
 *            naming convention. Only right for a base card, and only useful
 *            in the window between a release and the next mapping refresh.
 *   portrait ~6 KB member portraits, hot-linked from the official CDN. One per
 *            MEMBER, so any card of a known member resolves immediately.
 *
 * All four are optional everywhere. Components fall back to a typographic
 * panel, so the whole artwork layer can be switched off or repointed in one
 * place. `ui/CardArt.tsx` is what walks them in order at render time, moving
 * to the next only when the browser reports the current one failed to load --
 * a card cannot be shown a picture that does not exist, and a card of a known
 * member is never shown nothing.
 */
export interface ArtManifest {
  cards: Record<string, { file: string; width: number; height: number; sourceUrl: string }>;
}

export interface RemoteArtManifest {
  source?: string;
  generated?: string;
  cards: Record<string, string>;
}

export interface PortraitManifest {
  source?: string;
  byTalentSlug: Record<string, string>;
  byCard: Record<string, string>;
}

/** Mirror of tools/export_portraits.py's slug, for cards added after the build. */
function talentSlug(cardId: string): string {
  const withoutRarity = cardId.slice(0, cardId.lastIndexOf('_'));
  return withoutRarity.replace('_swim', '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Where horodori.com files its card pictures.
 *
 * The site's catalogue sends no CORS headers -- readable in a browser tab,
 * not fetchable from one -- so the browser cannot look a card up there. That
 * is exactly why the mapping is resolved in CI instead, where fetching is
 * allowed, and shipped as `remote-images.json`. This constant is only for
 * `guessedArtUrl`, the tier that runs when even the mapping has not caught up.
 */
const HORODORI_ART_BASE = 'https://www.horodori.com/images/cards/medium/';

export class ImageSource {
  private art: ArtManifest['cards'];
  private remote: RemoteArtManifest['cards'];
  private portraits: PortraitManifest | null;
  private base: string;
  private localArt: boolean;
  readonly enabled: boolean;

  constructor(art: ArtManifest | null, remote: RemoteArtManifest | null,
              portraits: PortraitManifest | null, base: string,
              enabled = true, localArt = false) {
    this.art = art?.cards ?? {};
    this.remote = remote?.cards ?? {};
    this.portraits = portraits;
    this.base = base;
    this.enabled = enabled;
    this.localArt = localArt;
  }

  /**
   * Full card artwork.
   *
   * Hot-linked from where it is published, like the portraits: the picture is
   * referenced, never copied into this repository. `localArt` switches to a
   * bundled copy for offline work, at which point the files do ship.
   */
  url(cardId: string): string | undefined {
    if (!this.enabled) return undefined;
    const entry = this.art[cardId];
    if (!entry) return undefined;
    return this.localArt ? `${this.base}cards/${entry.file}` : entry.sourceUrl;
  }

  /**
   * This card's real artwork, from the mapping CI keeps up to date.
   *
   * Keyed by card id like `url` is, but sourced without needing the desktop
   * app's local cache, so it normally already covers a card the live upstream
   * refresh has only just introduced -- including the costume variants
   * `guessedArtUrl` cannot derive.
   */
  remoteUrl(cardId: string): string | undefined {
    if (!this.enabled) return undefined;
    return this.remote[cardId];
  }

  /**
   * Small member portrait. Falls back to deriving the talent from the card id,
   * which is what lets a card released after the build still show a face.
   */
  portrait(cardId: string): string | undefined {
    if (!this.enabled || !this.portraits) return undefined;
    return this.portraits.byCard[cardId] ?? this.portraits.byTalentSlug[talentSlug(cardId)];
  }

  /**
   * The same portrait, asked for at a usable size.
   *
   * The manifest's URLs carry a width parameter because the host serves its
   * images through a resizing endpoint, and the thumbnails it hands the card
   * list are 67px wide -- fine at the size a row shows them, far too small for
   * a picture posted at 1200px. Rewriting that one parameter asks the same
   * source for the same portrait; it is not a second mapping, and a URL shaped
   * any other way comes back untouched.
   */
  portraitAt(cardId: string, width: number): string | undefined {
    const url = this.portrait(cardId);
    if (!url) return undefined;
    try {
      const parsed = new URL(url);
      if (!parsed.searchParams.has('w')) return url;
      parsed.searchParams.set('w', String(width));
      return parsed.toString();
    } catch {
      return url;   // Not a URL this can rewrite; the original still works.
    }
  }

  /** Where a given picture came from, for attribution or auditing. */
  sourceUrl(cardId: string): string | undefined {
    return this.art[cardId]?.sourceUrl;
  }

  /**
   * A last guess at this card's picture, from the card id alone.
   *
   * horodori.com names a base card's file after the id verbatim: underscores
   * to hyphens, `star.webp` appended (`shirakami_fubuki_5` ->
   * `shirakami-fubuki-5star.webp`). Measured against the 70 cards the mapping
   * now resolves properly, that rule is right for 52 and wrong for 18 -- every
   * costume and event variant, filed under an edited theme name instead
   * (`shirakami_fubuki_swim_5` is really `shirakami-fubuki-nagisa-twinkle-
   * 5star.webp`), which nothing derivable from the id can reach.
   *
   * So this is a backstop, not the plan: `remoteUrl` is what actually answers
   * this question, and the only window where a guess helps at all is between a
   * card's release and the next mapping refresh. Always returns a URL; whether
   * it is right is found out by trying it, exactly like a stale link.
   */
  guessedArtUrl(cardId: string): string {
    return `${HORODORI_ART_BASE}${cardId.replace(/_/g, '-')}star.webp`;
  }

  static async load(base: string, enabled = true, localArt = false): Promise<ImageSource> {
    if (!enabled) return new ImageSource(null, null, null, base, false, localArt);
    const read = async <T>(name: string): Promise<T | null> => {
      try {
        const response = await fetch(`${base}data/${name}`);
        return response.ok ? ((await response.json()) as T) : null;
      } catch {
        return null;   // A missing manifest just means that layer is off.
      }
    };
    const [art, remote, portraits] = await Promise.all([
      read<ArtManifest>('images.json'),
      read<RemoteArtManifest>('remote-images.json'),
      read<PortraitManifest>('portraits.json'),
    ]);
    return new ImageSource(art, remote, portraits, base,
                           !!(art || remote || portraits), localArt);
  }
}
