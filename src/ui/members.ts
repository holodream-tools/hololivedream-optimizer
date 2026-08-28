/**
 * How members and their branches are named and ordered in the interface.
 *
 * ID and EN members are shown under their English names. That is not
 * romanisation: Ouro Kronii is the name, and オーロ・クロニー is the Japanese
 * transliteration of it that the bundle happens to store. JP members keep their
 * Japanese names, which are theirs. Search accepts either, plus the short forms
 * people actually type.
 *
 * Almost none of this is hand-written, because almost none of it needs to be:
 *
 *   who is a member      `talent`, which is stable across Blooms and costumes
 *   the English name     the card id, which is already the romanised name
 *   who gets an English  the card number's block: 3xxx is ID, 4xxx is EN
 *   branch order         the lowest card number in each branch
 *
 * What is left is the handful of things no data carries: two names whose casing
 * the id cannot express, and the nicknames that are not part of anyone's name.
 * A new member or a whole new branch needs no edit here at all.
 *
 * `cardNumber` is absent from the build-time snapshot, whose source does not
 * keep the field, so every rule below falls back to something that works
 * without it and agrees with it.
 */
import type { CardBundle, CardJson, LeaderJson } from '../engine/types';

/** Card-number blocks. 0xxx and 6xxx are JP; these two are not. */
const ENGLISH_BLOCK = { from: 3000, to: 5000 };

/** Used only until the upstream refresh lands and card numbers are known. */
const ENGLISH_BRANCHES = new Set(['ID1期生', 'ID2期生', 'ID3期生', 'Myth', 'Promise', 'Advent']);

/** Casing the id cannot express. Keyed by the id's stem. */
const CASING: Record<string, string> = {
  irys: 'IRyS',
  ninomae_ina_nis: "Ninomae Ina'nis",
};

/** Nicknames that are not a part of the name, so splitting it cannot find them. */
const NICKNAMES: Record<string, string[]> = {
  hakos_baelz: ['bae'],
  airani_iofifteen: ['iofi'],
  mori_calliope: ['calli'],
  ninomae_ina_nis: ['ina'],
  fuwawa_abyssgard: ['fuwamoco'],
  mococo_abyssgard: ['fuwamoco'],
};

/**
 * Branch names that are a transliteration rather than a name.
 *
 * ゲーマーズ is the katakana spelling of the English word the unit is called,
 * exactly as オーロ・クロニー is of Ouro Kronii, and it is the only one of the
 * fifteen branches written that way -- the rest are either kanji, which reads
 * as Chinese, or already Latin. The data carries no English branch name, so
 * this one line is the whole mapping.
 */
const BRANCH_LABELS: Record<string, string> = {
  'ゲーマーズ': 'GAMERS',
};

/** What to show for a branch. The stored value stays whatever the data says. */
export function branchLabel(generation: string): string {
  return BRANCH_LABELS[generation] ?? generation;
}

/** `ouro_kronii_5` -> `ouro_kronii`; the trailing number is the Bloom. */
function stem(cardId: string): string {
  return cardId.replace(/^outfit:/, '').replace(/_\d+$/, '');
}

/**
 * The stem shared by every card of one member.
 *
 * A costume lengthens the id -- `ouro_kronii_5` and `ouro_kronii_swim_5` -- so
 * the common prefix of a member's ids is the member. Derived rather than
 * stripping a list of known costume words, which is what a new costume would
 * quietly break.
 */
function commonStem(ids: string[]): string {
  if (!ids.length) return '';
  const parts = ids.map((id) => stem(id).split('_'));
  const shortest = Math.min(...parts.map((row) => row.length));
  const shared: string[] = [];
  for (let i = 0; i < shortest; i++) {
    const word = parts[0][i];
    if (!parts.every((row) => row[i] === word)) break;
    shared.push(word);
  }
  return shared.join('_');
}

function titleCase(slug: string): string {
  return slug.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function isEnglishBranch(card: CardJson): boolean {
  if (card.cardNumber !== undefined) {
    return card.cardNumber >= ENGLISH_BLOCK.from && card.cardNumber < ENGLISH_BLOCK.to;
  }
  return ENGLISH_BRANCHES.has(card.generation);
}

interface Member { name: string; search: string[] }

/**
 * Built from the catalogue rather than looked up per card, because the English
 * name comes from the stem a member's cards share, which one card cannot know.
 */
let MEMBERS = new Map<string, Member>();
let BRANCH_RANK = new Map<string, number>();

export function indexMembers(bundle: CardBundle): void {
  const byTalent = new Map<string, CardJson[]>();
  for (const card of bundle.cards) {
    const list = byTalent.get(card.talent);
    if (list) list.push(card); else byTalent.set(card.talent, [card]);
  }

  const members = new Map<string, Member>();
  for (const [talent, cards] of byTalent) {
    const slug = commonStem(cards.map((card) => card.id));
    const english = isEnglishBranch(cards[0]) ? (CASING[slug] ?? titleCase(slug)) : '';
    const name = english || cards[0].name;
    members.set(talent, {
      name,
      // Every word of the English name is worth searching on its own: that is
      // where kronii, kiara, reine and most of the rest come from for free.
      search: [cards[0].name, english, ...english.toLowerCase().split(' '),
        ...(NICKNAMES[slug] ?? [])].filter(Boolean).map((value) => value.toLowerCase()),
    });
  }
  MEMBERS = members;

  // Branch order: the lowest card number in each. A new branch arrives in its
  // own number block and places itself, whatever it is called.
  const lowest = new Map<string, number>();
  for (const card of bundle.cards) {
    if (card.cardNumber === undefined) continue;
    const seen = lowest.get(card.generation);
    if (seen === undefined || card.cardNumber < seen) lowest.set(card.generation, card.cardNumber);
  }
  BRANCH_RANK = lowest;
}

/** The name to show. */
export function memberName(card: { id: string; name: string; talent?: string }): string {
  return (card.talent ? MEMBERS.get(card.talent)?.name : undefined) ?? card.name;
}

/**
 * A Leader's label is `メンバー名（衣装名）`, so only the part before the
 * bracket is a person and only that part is replaced.
 */
export function leaderName(leader: { id: string; name: string; talent?: string }): string {
  const shown = leader.talent ? MEMBERS.get(leader.talent)?.name : undefined;
  if (!shown || shown === leader.name) return leader.name;
  const open = leader.name.indexOf('（');
  return open < 0 ? shown : `${shown}${leader.name.slice(open)}`;
}

/**
 * Everything a card can be found by, lowercased: the Japanese name the bundle
 * carries, the costume title, the branch, the English name and its parts.
 *
 * Deliberately NOT the card id -- every id ends in `_5`, so including it made
 * typing a single digit match the entire catalogue.
 */
export function searchIndex(card: CardJson): string {
  const member = MEMBERS.get(card.talent);
  // Both spellings of the branch: a label shown on screen has to be typeable,
  // and the stored one stays searchable for anyone who knows it.
  return [card.name, card.title, card.generation, branchLabel(card.generation),
    ...(member?.search ?? [])].join(' ').toLowerCase();
}

/** The same haystack for a Leader Outfit. */
export function leaderSearchIndex(leader: LeaderJson): string {
  const member = MEMBERS.get(leader.talent);
  return [leader.name, ...(member?.search ?? [])].join(' ').toLowerCase();
}

/**
 * Branch order for the snapshot that carries no card numbers.
 *
 * Written to agree with what the numbers say, so the list does not visibly
 * reshuffle when the upstream refresh arrives a moment after first paint. Two
 * entries here are not where a reasonable guess would put them, and the data is
 * why: ゲーマーズ formed before 2期生, and the game files ReGLOSS after EN.
 */
export const GENERATION_ORDER: readonly string[] = [
  '0期生', '1期生', 'ゲーマーズ', '2期生', '3期生', '4期生', '5期生', 'holoX',
  'ID1期生', 'ID2期生', 'ID3期生',
  'Myth', 'Promise', 'Advent',
  'ReGLOSS',
];

const FALLBACK_RANK = new Map(GENERATION_ORDER.map((name, index) => [name, index]));

/** Card numbers when they are known, the written order when they are not. */
function branchRank(name: string): number {
  const fromData = BRANCH_RANK.get(name);
  if (fromData !== undefined) return fromData;
  const written = FALLBACK_RANK.get(name);
  return written === undefined ? Number.MAX_SAFE_INTEGER : written;
}

export function compareGenerations(a: string, b: string): number {
  return branchRank(a) - branchRank(b) || a.localeCompare(b, 'ja');
}

/**
 * Catalogue order: branch, then the member, then the card.
 *
 * By member rather than straight by card number, because a member's costume is
 * numbered wherever it was released -- a 0期生 swimsuit is card 18, well after
 * the whole branch -- and the two belong side by side.
 */
export function compareCards(a: CardJson, b: CardJson): number {
  return compareGenerations(a.generation, b.generation)
    || a.talent.localeCompare(b.talent, 'ja')
    || (a.cardNumber ?? 0) - (b.cardNumber ?? 0)
    || a.id.localeCompare(b.id, 'en');
}

/** The branches present in the data, in listing order. */
export function sortedGenerations(cards: readonly CardJson[]): string[] {
  return [...new Set(cards.map((card) => card.generation))].sort(compareGenerations);
}
