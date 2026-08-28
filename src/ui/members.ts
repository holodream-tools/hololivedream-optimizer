/**
 * How members and their branches are named and ordered in the interface.
 *
 * The bundle stores every name in Japanese, which is right for the JP branch and
 * wrong for the others: an English-speaking player looking for Kronii does not
 * search for オーロ・クロニー, and the game's own English client does not show it
 * either. ID and EN members are therefore displayed under their English names,
 * JP members keep theirs, and search accepts either plus the short forms people
 * actually type.
 *
 * Keyed on the card id, which already carries the romanised name and is stable
 * across Blooms and costumes -- `airani_iofifteen_5` and
 * `airani_iofifteen_swim_5` are the same person.
 */
import type { CardJson, LeaderJson } from '../engine/types';

interface Member { name: string; aliases: string[] }

/** ID and EN branches only. Anyone absent keeps the bundle's own name. */
const ENGLISH: Record<string, Member> = {
  // ID
  airani_iofifteen: { name: 'Airani Iofifteen', aliases: ['iofi'] },
  ayunda_risu: { name: 'Ayunda Risu', aliases: ['risu'] },
  moona_hoshinova: { name: 'Moona Hoshinova', aliases: ['moona'] },
  anya_melfissa: { name: 'Anya Melfissa', aliases: ['anya'] },
  kureiji_ollie: { name: 'Kureiji Ollie', aliases: ['ollie'] },
  pavolia_reine: { name: 'Pavolia Reine', aliases: ['reine'] },
  kaela_kovalskia: { name: 'Kaela Kovalskia', aliases: ['kaela'] },
  kobo_kanaeru: { name: 'Kobo Kanaeru', aliases: ['kobo'] },
  vestia_zeta: { name: 'Vestia Zeta', aliases: ['zeta'] },
  // EN
  mori_calliope: { name: 'Mori Calliope', aliases: ['calli', 'calliope'] },
  ninomae_ina_nis: { name: "Ninomae Ina'nis", aliases: ['ina'] },
  takanashi_kiara: { name: 'Takanashi Kiara', aliases: ['kiara'] },
  hakos_baelz: { name: 'Hakos Baelz', aliases: ['bae', 'baelz'] },
  irys: { name: 'IRyS', aliases: [] },
  ouro_kronii: { name: 'Ouro Kronii', aliases: ['kronii'] },
  fuwawa_abyssgard: { name: 'Fuwawa Abyssgard', aliases: ['fuwawa', 'fuwamoco'] },
  mococo_abyssgard: { name: 'Mococo Abyssgard', aliases: ['mococo', 'fuwamoco'] },
  koseki_bijou: { name: 'Koseki Bijou', aliases: ['bijou'] },
  nerissa_ravencroft: { name: 'Nerissa Ravencroft', aliases: ['nerissa'] },
  shiori_novella: { name: 'Shiori Novella', aliases: ['shiori'] },
};

/** `airani_iofifteen_swim_5` -> `airani_iofifteen`. */
function slugOf(cardId: string): string {
  return cardId.replace(/^outfit:/, '').replace(/_\d+$/, '').replace(/_swim$/, '');
}

/** The name to show. JP members keep the bundle's; ID and EN get English. */
export function memberName(card: { id: string; name: string }): string {
  return ENGLISH[slugOf(card.id)]?.name ?? card.name;
}

/**
 * A Leader's label is `メンバー名（衣装名）`, so only the part before the
 * bracket is a person and only that part is translated.
 */
export function leaderName(leader: { id: string; name: string }): string {
  const english = ENGLISH[slugOf(leader.id)]?.name;
  if (!english) return leader.name;
  const open = leader.name.indexOf('（');
  return open < 0 ? english : `${english}${leader.name.slice(open)}`;
}

/**
 * Everything a card can be found by, lowercased: the Japanese name the bundle
 * carries, the costume title, the English name and the short forms. Renaming
 * what is displayed must not cost the ability to search for the old name.
 */
export function searchIndex(card: CardJson): string {
  const member = ENGLISH[slugOf(card.id)];
  return [card.name, card.title, card.generation, card.id,
    member?.name ?? '', ...(member?.aliases ?? [])].join(' ').toLowerCase();
}

/** The same haystack for a Leader Outfit. */
export function leaderSearchIndex(leader: LeaderJson): string {
  const member = ENGLISH[slugOf(leader.id)];
  return [leader.name, leader.id, member?.name ?? '', ...(member?.aliases ?? [])]
    .join(' ').toLowerCase();
}

/**
 * Branch order as hololive itself lists them: JP by debut, then ID, then EN.
 *
 * Explicit rather than derived. The bundle's own order is whatever the upstream
 * export happened to emit, alphabetical puts ID1期生 above 0期生, and neither
 * survives the next data update. Anything not listed here sorts after
 * everything listed, so a new branch appears at the end instead of scrambling
 * the rest -- and shows up somewhere visible enough to be added here.
 */
export const GENERATION_ORDER: readonly string[] = [
  '0期生', '1期生', '2期生', 'ゲーマーズ', '3期生', '4期生', '5期生', 'holoX', 'ReGLOSS',
  'ID1期生', 'ID2期生', 'ID3期生',
  'Myth', 'Promise', 'Advent',
];

const RANK = new Map(GENERATION_ORDER.map((name, index) => [name, index]));

/** Sort comparator for branch names; unknown ones go last, in name order. */
export function compareGenerations(a: string, b: string): number {
  const x = RANK.get(a) ?? Number.MAX_SAFE_INTEGER;
  const y = RANK.get(b) ?? Number.MAX_SAFE_INTEGER;
  return x - y || a.localeCompare(b, 'ja');
}

/** The branches present in the data, in listing order. */
export function sortedGenerations(cards: readonly CardJson[]): string[] {
  return [...new Set(cards.map((card) => card.generation))].sort(compareGenerations);
}
