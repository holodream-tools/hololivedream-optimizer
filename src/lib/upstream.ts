/**
 * Live card data.
 *
 * The bundled `cards.json` is a snapshot taken at build time, so a newly
 * released card would otherwise wait for the next deploy. The upstream dataset
 * serves CORS headers, so the browser can read it directly: ~18 KB gzipped and a
 * few milliseconds to reshape.
 *
 * The bundled copy still loads first and always wins on failure — a page that
 * cannot open because someone else's server is down would be a bad trade.
 *
 * Artwork is NOT refreshed this way: the thumbnail catalogue sends no CORS
 * headers, so a brand-new card appears with its numbers but without a picture
 * until the next deploy. Every card component already renders without one.
 */
import type { BloomJson, CardBundle, CardJson, LeaderJson, OutfitPayload } from '../engine/types';

export const UPSTREAM_CARDS_URL =
  'https://raw.githubusercontent.com/konono/holodreams_solver/main/data/cards.json';

interface UpstreamPotential {
  potential?: number;
  ref_stats_lv80?: { performance?: number; technique?: number; sense?: number };
  support_skill?: Record<string, unknown> | null;
  center_skill?: Record<string, unknown> | null;
  special_skill?: Record<string, unknown> | null;
  costume_skill?: OutfitPayload | null;
}

interface UpstreamCard {
  id?: string;
  character?: string;
  card_name?: string;
  rarity?: number | string;
  type?: string;
  group?: string;
  potential_data?: UpstreamPotential[];
}

interface UpstreamPayload { generated?: string; cards?: UpstreamCard[] }

/**
 * Upstream writes the attribute lowercase; the build-time export title-cases it
 * because the UI shows it verbatim. The engine casefolds either way, so this
 * only keeps the two paths producing identical bundles.
 */
function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : '';
}

/** Mirror of app/providers/holodori_public.py's normalize step. */
export function normalizeUpstream(payload: UpstreamPayload): CardBundle {
  const cards: CardJson[] = [];
  const leaders: LeaderJson[] = [];

  for (const item of payload.cards ?? []) {
    if (!item.id || !item.character) continue;
    const blooms: Record<string, BloomJson> = {};
    const outfits: Record<string, OutfitPayload | null> = {};
    for (const row of item.potential_data ?? []) {
      const potential = Number(row.potential ?? -1);
      if (!Number.isFinite(potential) || potential < 0) continue;
      const stats = row.ref_stats_lv80 ?? {};
      blooms[String(potential)] = {
        performance: Number(stats.performance ?? 0),
        technique: Number(stats.technique ?? 0),
        sense: Number(stats.sense ?? 0),
        support: row.support_skill ?? null,
        active: row.center_skill ?? null,
        special: row.special_skill ?? null,
      };
      outfits[String(potential)] = row.costume_skill ?? null;
    }
    const levels = Object.keys(blooms).map(Number);
    if (!levels.length) continue;
    const maxBloom = Math.max(...levels);

    cards.push({
      id: item.id,
      talent: `talent:${item.character}`,
      name: item.character,
      title: item.card_name ?? '',
      type: titleCase(item.type ?? ''),
      generation: item.group ?? '',
      maxBloom,
      blooms,
    });
    leaders.push({
      id: `outfit:${item.id}`,
      talent: `talent:${item.character}`,
      name: `${item.character}（${item.card_name ?? ''}）`,
      maxBloom,
      outfits,
    });
  }

  cards.sort((a, b) => a.id.localeCompare(b.id));
  leaders.sort((a, b) => a.id.localeCompare(b.id));
  return { cards, leaders };
}

export interface RefreshOutcome {
  bundle: CardBundle;
  /** Card ids present upstream but not in the bundled snapshot. */
  added: string[];
  /** Card ids in the snapshot that upstream no longer lists. */
  removed: string[];
}

/**
 * Fetch and reshape the upstream dataset. Resolves to null on any failure --
 * network, CORS, malformed JSON, or a response that yields no usable cards --
 * so the caller simply keeps the bundled data.
 */
export async function fetchUpstream(bundled: CardBundle, signal?: AbortSignal): Promise<RefreshOutcome | null> {
  try {
    const response = await fetch(UPSTREAM_CARDS_URL, { signal, cache: 'no-cache' });
    if (!response.ok) return null;
    const bundle = normalizeUpstream(await response.json());
    // A response that parses but carries nothing usable is a failure, not an
    // instruction to wipe the card list.
    if (bundle.cards.length === 0) return null;

    const before = new Set(bundled.cards.map((card) => card.id));
    const after = new Set(bundle.cards.map((card) => card.id));
    return {
      bundle,
      added: bundle.cards.filter((card) => !before.has(card.id)).map((card) => card.id),
      removed: bundled.cards.filter((card) => !after.has(card.id)).map((card) => card.id),
    };
  } catch {
    return null;
  }
}
