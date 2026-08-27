/**
 * A team in a link.
 *
 * The link carries the team and what it was being looked at with -- five card
 * ids, the Leader Outfit, the Bloom each card was set to, and the chart. It
 * does not carry the sender's collection: that would make the URL enormous and
 * would overwrite the recipient's own inventory, which is theirs.
 *
 * Because the Blooms travel with the team, a shared link scores the same on the
 * recipient's screen as it did on the sender's, even when the recipient owns
 * none of those cards.
 *
 * The payload lives in the fragment, so it is never sent to the server.
 */
export interface SharedTeam {
  members: string[];
  leaderId: string;
  /** Bloom per member id, and for the Leader's own card. */
  blooms: Record<string, number>;
  songKey?: string;
  difficulty?: string;
}

const PREFIX = '#t=';
const VERSION = 1;

/** Compact form: positional, because every byte shows up in the address bar. */
interface Wire {
  v: number;
  m: string[];
  l: string;
  b: number[];
  lb?: number;
  s?: string;
  d?: string;
}

export function encodeTeam(team: SharedTeam): string {
  const leaderCard = team.leaderId.replace(/^outfit:/, '');
  const wire: Wire = {
    v: VERSION,
    m: team.members,
    l: team.leaderId,
    b: team.members.map((id) => team.blooms[id] ?? 0),
  };
  if (team.blooms[leaderCard] !== undefined) wire.lb = team.blooms[leaderCard];
  if (team.songKey) wire.s = team.songKey;
  if (team.difficulty) wire.d = team.difficulty;
  return PREFIX + encodeURIComponent(JSON.stringify(wire));
}

/**
 * Read a team out of a URL fragment.
 *
 * Returns null for anything that is not a team this version wrote. A link is
 * untrusted input like any other: every field is checked, and a malformed one
 * yields null rather than a half-restored team.
 */
export function decodeTeam(hash: string): SharedTeam | null {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const wire = JSON.parse(decodeURIComponent(hash.slice(PREFIX.length))) as Partial<Wire>;
    if (wire?.v !== VERSION) return null;
    if (!Array.isArray(wire.m) || wire.m.length !== 5) return null;
    if (!wire.m.every((id) => typeof id === 'string' && id.length > 0)) return null;
    if (typeof wire.l !== 'string' || !wire.l) return null;

    const blooms: Record<string, number> = {};
    const bloomList = Array.isArray(wire.b) ? wire.b : [];
    // `typeof`, not Number(): null and '' both coerce to a perfectly valid 0,
    // and a Bloom the sender never sent is not a Bloom of 0.
    const bloomAt = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10
        ? Math.floor(value) : null;
    wire.m.forEach((id, index) => {
      const value = bloomAt(bloomList[index]);
      if (value !== null) blooms[id] = value;
    });
    const leaderCard = wire.l.replace(/^outfit:/, '');
    const leaderBloom = bloomAt(wire.lb);
    if (leaderBloom !== null) blooms[leaderCard] = leaderBloom;

    return {
      members: wire.m,
      leaderId: wire.l,
      blooms,
      songKey: typeof wire.s === 'string' ? wire.s : undefined,
      difficulty: typeof wire.d === 'string' ? wire.d : undefined,
    };
  } catch {
    return null;
  }
}

/** The full link to hand someone, honouring whatever base path the app is on. */
export function shareUrl(team: SharedTeam): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${encodeTeam(team)}`;
}

/** Drop the payload from the address bar without reloading or adding history. */
export function stripHash(): void {
  const { origin, pathname, search } = window.location;
  window.history.replaceState(null, '', `${origin}${pathname}${search}`);
}
