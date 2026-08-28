/**
 * The settings the player made, kept between visits.
 *
 * Only choices go in here -- what they own, who they picked, which song they
 * were looking at. Results do not: a Top 10, a timeline or an attribution is
 * cheaper to recompute than to keep valid, and a stale one that looks fresh is
 * worse than none.
 *
 * The inventory keeps its own older key and format, because a file exported
 * from the desktop app imports into it. This store sits beside it.
 *
 * VERSION exists so a future format change is a migration or a discard rather
 * than a crash: anything not written by this version is dropped on read.
 */
const KEY = 'hololivedream.prefs';
const VERSION = 1;

export interface Prefs {
  /** 自選隊伍: the five card ids, in the order they were picked. */
  manualPicks: string[];
  /** 自選隊伍: the Leader Outfit id. */
  manualLeaderId: string;
  /** The chart the song and compare pages share. */
  songKey: string;
  /** Difficulty filter on the song list. */
  difficulty: string;
  /** Whether the optimiser hides near-duplicate rows. */
  oneLeaderPerTeam: boolean;
  minDistinctMembers: number;
  /** How many ranked rows the optimiser shows. */
  shownCount: number;
  /**
   * Whether the first-run hint was dismissed for good.
   *
   * Absent from anything written before this field existed, and `sanitise`
   * gives those the default -- which shows the hint, the right answer for
   * someone who never chose to hide it. That is why adding it needs no
   * VERSION bump: the old records are still readable, they just say nothing
   * about this, and saying nothing means "not dismissed".
   */
  hintDismissed: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  manualPicks: [],
  manualLeaderId: '',
  songKey: '',
  difficulty: 'Expert',
  oneLeaderPerTeam: true,
  minDistinctMembers: 0,
  shownCount: 20,
  hintDismissed: false,
};

/** Coerce whatever was stored into a valid Prefs; never throw, never trust. */
function sanitise(raw: unknown): Prefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
  const row = raw as Partial<Prefs>;
  const picks = Array.isArray(row.manualPicks)
    ? row.manualPicks.filter((id): id is string => typeof id === 'string').slice(0, 5)
    : [];
  return {
    manualPicks: picks,
    manualLeaderId: typeof row.manualLeaderId === 'string' ? row.manualLeaderId : '',
    songKey: typeof row.songKey === 'string' ? row.songKey : '',
    difficulty: typeof row.difficulty === 'string' ? row.difficulty : DEFAULT_PREFS.difficulty,
    oneLeaderPerTeam: typeof row.oneLeaderPerTeam === 'boolean'
      ? row.oneLeaderPerTeam : DEFAULT_PREFS.oneLeaderPerTeam,
    minDistinctMembers: Number.isFinite(row.minDistinctMembers)
      ? Math.max(0, Math.min(5, Number(row.minDistinctMembers))) : 0,
    shownCount: Number.isFinite(row.shownCount)
      ? Math.max(5, Math.min(30, Number(row.shownCount))) : DEFAULT_PREFS.shownCount,
    hintDismissed: row.hintDismissed === true,
  };
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const stored = JSON.parse(raw) as { version?: number; prefs?: unknown };
    // A different version is discarded rather than guessed at. When a migration
    // is ever worth writing, it goes here.
    if (stored?.version !== VERSION) return { ...DEFAULT_PREFS };
    return sanitise(stored.prefs);
  } catch {
    // Private window, blocked site data, or corrupt JSON: start clean.
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, prefs }));
  } catch {
    // Nothing to do; the session still works, it just will not be remembered.
  }
}

/** Forget the settings this store owns. The inventory is cleared separately. */
export function clearPrefs(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ignore: there is nothing useful to do about a storage that refuses.
  }
}

export const PREFS_KEY = KEY;
export const PREFS_VERSION = VERSION;
