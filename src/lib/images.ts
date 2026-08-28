/**
 * Card artwork, in two sizes with different lifetimes.
 *
 *   art      192x108 card thumbnails, shipped with the build. One per CARD, so
 *            a newly released card has none until the next deploy.
 *   portrait ~6 KB member portraits, hot-linked from the official CDN. One per
 *            MEMBER, so a new card of an existing member resolves immediately.
 *
 * Both are optional everywhere. Components fall back to a typographic panel, so
 * the whole artwork layer can be switched off or repointed in one place.
 */
export interface ArtManifest {
  cards: Record<string, { file: string; width: number; height: number; sourceUrl: string }>;
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

export class ImageSource {
  private art: ArtManifest['cards'];
  private portraits: PortraitManifest | null;
  private base: string;
  private localArt: boolean;
  readonly enabled: boolean;

  constructor(art: ArtManifest | null, portraits: PortraitManifest | null, base: string,
              enabled = true, localArt = false) {
    this.art = art?.cards ?? {};
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

  static async load(base: string, enabled = true, localArt = false): Promise<ImageSource> {
    if (!enabled) return new ImageSource(null, null, base, false, localArt);
    const read = async <T>(name: string): Promise<T | null> => {
      try {
        const response = await fetch(`${base}data/${name}`);
        return response.ok ? ((await response.json()) as T) : null;
      } catch {
        return null;   // A missing manifest just means that layer is off.
      }
    };
    const [art, portraits] = await Promise.all([
      read<ArtManifest>('images.json'),
      read<PortraitManifest>('portraits.json'),
    ]);
    return new ImageSource(art, portraits, base, !!(art || portraits), localArt);
  }
}
