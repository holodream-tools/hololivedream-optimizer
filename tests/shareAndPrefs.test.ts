/**
 * A link and a saved setting are both untrusted input by the time they come
 * back: one was typed by whoever sent it, the other was written by a version of
 * this app that may no longer exist. Both readers must return something valid
 * or nothing, never a half-restored team.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The suite runs on node, which has no Web Storage. This is the smallest thing
// that behaves like it, so the readers are exercised through the same API the
// browser gives them.
class MemoryStorage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
}
(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
import { decodeTeam, encodeTeam, type SharedTeam } from '../src/lib/share';
import { DEFAULT_PREFS, clearPrefs, loadPrefs, savePrefs, PREFS_KEY } from '../src/lib/prefs';

const team: SharedTeam = {
  members: ['a_5', 'b_5', 'c_5', 'd_5', 'e_5'],
  leaderId: 'outfit:a_5',
  blooms: { a_5: 4, b_5: 2, c_5: 0, d_5: 1, e_5: 3 },
  songKey: 'm0087:Expert',
  difficulty: 'Expert',
};

describe('share links', () => {
  it('round-trips a team, its Blooms and what it was being viewed with', () => {
    const back = decodeTeam(encodeTeam(team))!;
    expect(back.members).toEqual(team.members);
    expect(back.leaderId).toBe(team.leaderId);
    expect(back.songKey).toBe(team.songKey);
    expect(back.difficulty).toBe(team.difficulty);
    for (const id of team.members) expect(back.blooms[id]).toBe(team.blooms[id]);
  });

  it('carries the Leader card\'s own Bloom even when it is not a member', () => {
    const outsider: SharedTeam = {
      ...team, leaderId: 'outfit:z_5', blooms: { ...team.blooms, z_5: 4 },
    };
    expect(decodeTeam(encodeTeam(outsider))!.blooms.z_5).toBe(4);
  });

  it('does not carry the sender\'s collection', () => {
    // The whole point of the first version: the link stays short and the
    // recipient's own inventory is not something the sender gets to overwrite.
    const encoded = encodeTeam(team);
    expect(encoded.length).toBeLessThan(400);
    const back = decodeTeam(encoded)!;
    expect(Object.keys(back.blooms).sort()).toEqual([...team.members].sort());
  });

  it('returns null for anything that is not a team this version wrote', () => {
    expect(decodeTeam('')).toBeNull();
    expect(decodeTeam('#other=1')).toBeNull();
    expect(decodeTeam('#t=not-json')).toBeNull();
    expect(decodeTeam(`#t=${encodeURIComponent('{"v":99,"m":[],"l":"x"}')}`)).toBeNull();
    // Four members is not a team.
    expect(decodeTeam(`#t=${encodeURIComponent(JSON.stringify(
      { v: 1, m: ['a', 'b', 'c', 'd'], l: 'outfit:a', b: [0, 0, 0, 0] }))}`)).toBeNull();
    // No Leader.
    expect(decodeTeam(`#t=${encodeURIComponent(JSON.stringify(
      { v: 1, m: ['a', 'b', 'c', 'd', 'e'], l: '', b: [] }))}`)).toBeNull();
  });

  it('drops a Bloom that is out of range rather than trusting it', () => {
    const hostile = `#t=${encodeURIComponent(JSON.stringify(
      { v: 1, m: ['a', 'b', 'c', 'd', 'e'], l: 'outfit:a', b: [99, -1, 'x', null, 2] }))}`;
    const back = decodeTeam(hostile)!;
    expect(back.blooms.a).toBeUndefined();
    expect(back.blooms.b).toBeUndefined();
    expect(back.blooms.c).toBeUndefined();
    expect(back.blooms.d).toBeUndefined();
    expect(back.blooms.e).toBe(2);
  });
});

describe('saved settings', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips what it stores', () => {
    const prefs = { ...DEFAULT_PREFS, manualPicks: ['a', 'b'], manualLeaderId: 'outfit:a', shownCount: 12 };
    savePrefs(prefs);
    expect(loadPrefs()).toEqual(prefs);
  });

  it('stores nothing that has to be recomputed', () => {
    savePrefs({ ...DEFAULT_PREFS, manualPicks: ['a'] });
    const raw = localStorage.getItem(PREFS_KEY)!;
    for (const forbidden of ['rows', 'candidates', 'ranked', 'timeline', 'attribution', 'score']) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('discards a payload written by another version instead of using it', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      version: 999, prefs: { manualPicks: ['ghost'], shownCount: 12 },
    }));
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('survives corrupt or hostile stored values', () => {
    localStorage.setItem(PREFS_KEY, 'not json at all');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);

    localStorage.setItem(PREFS_KEY, JSON.stringify({
      version: 1,
      prefs: { manualPicks: 'nope', shownCount: 9999, minDistinctMembers: -5, difficulty: 42 },
    }));
    const back = loadPrefs();
    expect(back.manualPicks).toEqual([]);
    expect(back.shownCount).toBe(30);          // clamped, not accepted
    expect(back.minDistinctMembers).toBe(0);
    expect(back.difficulty).toBe(DEFAULT_PREFS.difficulty);
  });

  it('shows the first-run hint until it is dismissed for good', () => {
    // Default is "not dismissed", so a visitor with nothing stored sees it.
    expect(DEFAULT_PREFS.hintDismissed).toBe(false);

    savePrefs({ ...DEFAULT_PREFS, hintDismissed: true });
    expect(loadPrefs().hintDismissed).toBe(true);

    // Clearing saved settings brings it back, which is the only way back.
    clearPrefs();
    expect(loadPrefs().hintDismissed).toBe(false);
  });

  it('treats a record written before the hint existed as not dismissed', () => {
    // The field was added without a VERSION bump, so records that predate it
    // still load. Anything but a literal true means the player never chose.
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      version: 1, prefs: { manualPicks: ['a_5'], shownCount: 20 },
    }));
    expect(loadPrefs().hintDismissed).toBe(false);
    expect(loadPrefs().manualPicks).toEqual(['a_5']);

    for (const value of ['true', 1, {}, null]) {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        version: 1, prefs: { hintDismissed: value },
      }));
      expect(loadPrefs().hintDismissed).toBe(false);
    }
  });

  it('keeps at most five picks', () => {
    savePrefs({ ...DEFAULT_PREFS, manualPicks: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
    expect(loadPrefs().manualPicks).toHaveLength(5);
  });

  it('clears', () => {
    savePrefs({ ...DEFAULT_PREFS, manualLeaderId: 'outfit:a' });
    clearPrefs();
    expect(localStorage.getItem(PREFS_KEY)).toBeNull();
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('does not throw when storage itself refuses', () => {
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => savePrefs(DEFAULT_PREFS)).not.toThrow();
    vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });
});
