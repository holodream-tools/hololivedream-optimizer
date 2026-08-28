/**
 * Names and branch order, checked against the real bundle rather than a fixture,
 * so a data update that adds a member or a branch shows up here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GENERATION_ORDER, branchLabel, compareCards, compareGenerations, indexMembers, leaderName,
  memberName, searchIndex, sortedGenerations,
} from '../src/ui/members';
import type { CardBundle, CardJson } from '../src/engine/types';

const bundle: CardBundle = JSON.parse(
  readFileSync(new URL('../public/data/cards.json', import.meta.url), 'utf8'));

/** The game's own card numbers, as upstream serves them. */
const NUMBERS: Record<string, number> = {
  "airani_iofifteen_5": 3003,
  "akai_haato_5": 5,
  "aki_rosenthal_5": 4,
  "anya_melfissa_5": 3005,
  "ayunda_risu_5": 3001,
  "azki_5": 13,
  "fuwawa_abyssgard_5": 4016,
  "hakos_baelz_5": 4012,
  "hakui_koyori_5": 37,
  "himemori_luna_5": 28,
  "himemori_luna_swim_5": 28,
  "hoshimachi_suisei_5": 18,
  "hoshimachi_suisei_swim_5": 18,
  "houshou_marine_5": 23,
  "ichijou_ririka_5": 6003,
  "inugami_korone_5": 17,
  "irys_5": 4007,
  "juufuutei_raden_5": 6004,
  "kaela_kovalskia_5": 3008,
  "kazama_iroha_5": 39,
  "kobo_kanaeru_5": 3009,
  "koseki_bijou_5": 4014,
  "kureiji_ollie_5": 3004,
  "kureiji_ollie_swim_5": 3004,
  "la_darknesss_5": 35,
  "mococo_abyssgard_5": 4017,
  "momosuzu_nene_5": 31,
  "moona_hoshinova_5": 3002,
  "mori_calliope_5": 4001,
  "mori_calliope_swim_5": 4001,
  "nakiri_ayame_5": 10,
  "nakiri_ayame_swim_5": 10,
  "natsuiro_matsuri_5": 7,
  "nekomata_okayu_5": 16,
  "nerissa_ravencroft_5": 4015,
  "ninomae_ina_nis_5": 4003,
  "ninomae_ina_nis_swim_5": 4003,
  "omaru_polka_5": 34,
  "ookami_mio_5": 14,
  "oozora_subaru_5": 12,
  "oozora_subaru_swim_5": 12,
  "otonose_kanade_5": 6002,
  "otonose_kanade_swim_5": 6002,
  "ouro_kronii_5": 4010,
  "pavolia_reine_5": 3006,
  "robocosan_5": 2,
  "sakura_miko_5": 15,
  "sakura_miko_swim_5": 15,
  "shiori_novella_5": 4013,
  "shirakami_fubuki_5": 6,
  "shiranui_flare_5": 21,
  "shiranui_flare_swim_5": 21,
  "shirogane_noel_5": 22,
  "shirogane_noel_swim_5": 22,
  "shishiro_botan_5": 32,
  "takanashi_kiara_5": 4002,
  "takane_lui_5": 36,
  "todoroki_hajime_5": 6005,
  "tokino_sora_5": 1,
  "tokoyami_towa_5": 27,
  "tsunomaki_watame_5": 26,
  "tsunomaki_watame_swim_5": 26,
  "usada_pekora_5": 19,
  "vestia_zeta_5": 3007,
  "yukihana_lamy_5": 30,
  "yuzuki_choco_5": 11
};

// The names come from the catalogue, so the catalogue has to be indexed first.
indexMembers(bundle);

const cardById = (id: string) => bundle.cards.find((card) => card.id === id)!;
const ID_EN = new Set(['ID1期生', 'ID2期生', 'ID3期生', 'Myth', 'Promise', 'Advent']);

describe('member names', () => {
  it('shows ID and EN members in English', () => {
    expect(memberName(cardById('ouro_kronii_5'))).toBe('Ouro Kronii');
    expect(memberName(cardById('takanashi_kiara_5'))).toBe('Takanashi Kiara');
    expect(memberName(cardById('pavolia_reine_5'))).toBe('Pavolia Reine');
    expect(memberName(cardById('hakos_baelz_5'))).toBe('Hakos Baelz');
    expect(memberName(cardById('airani_iofifteen_5'))).toBe('Airani Iofifteen');
  });

  it('leaves JP members alone', () => {
    const suisei = cardById('hoshimachi_suisei_5');
    expect(memberName(suisei)).toBe(suisei.name);
    expect(memberName(suisei)).toMatch(/[ぁ-んァ-ヶ一-龥]/);
  });

  it('leaves no ID or EN member displayed in Japanese', () => {
    // The property that matters, not "the name changed": IRyS is already Latin
    // in the bundle, so an unchanged name there is the correct outcome.
    const japanese = /[ぁ-んァ-ヶ一-龥]/;
    const stillJapanese = bundle.cards
      .filter((card) => ID_EN.has(card.generation) && japanese.test(memberName(card)))
      .map((card) => card.id);
    expect(stillJapanese).toEqual([]);
  });

  it('translates alternate costumes of the same member too', () => {
    const swim = bundle.cards.find((card) => card.id.includes('_swim') && ID_EN.has(card.generation));
    if (swim) expect(memberName(swim)).not.toBe(swim.name);
  });

  it('keeps the costume on a Leader label and translates only the person', () => {
    const leader = bundle.leaders.find((row) => row.id === 'outfit:ouro_kronii_5')!;
    const shown = leaderName(leader);
    expect(shown.startsWith('Ouro Kronii')).toBe(true);
    // Whatever was in brackets survives untouched.
    const open = leader.name.indexOf('（');
    if (open >= 0) expect(shown.endsWith(leader.name.slice(open))).toBe(true);
  });

  it('leaves a JP Leader label untouched', () => {
    const leader = bundle.leaders.find((row) => row.id === 'outfit:hoshimachi_suisei_5');
    if (leader) expect(leaderName(leader)).toBe(leader.name);
  });
});

describe('search', () => {
  const find = (needle: string) => bundle.cards
    .filter((card) => searchIndex(card).includes(needle.toLowerCase()))
    .map((card) => card.id);

  it('finds ID and EN members by the short name people type', () => {
    for (const [needle, id] of [
      ['kronii', 'ouro_kronii_5'], ['bae', 'hakos_baelz_5'], ['iofi', 'airani_iofifteen_5'],
      ['kiara', 'takanashi_kiara_5'], ['reine', 'pavolia_reine_5'], ['calli', 'mori_calliope_5'],
      ['ina', 'ninomae_ina_nis_5'], ['ollie', 'kureiji_ollie_5'], ['zeta', 'vestia_zeta_5'],
    ] as const) {
      expect(find(needle)).toContain(id);
    }
  });

  it('finds a branch by the label shown on screen and by the stored name', () => {
    expect(find('gamers').length).toBeGreaterThan(0);
    expect(find('ゲーマーズ').length).toBe(find('gamers').length);
  });

  it('finds fuwamoco as a pair', () => {
    const both = find('fuwamoco');
    expect(both).toContain('fuwawa_abyssgard_5');
    expect(both).toContain('mococo_abyssgard_5');
  });

  it('still finds everyone by the Japanese name the bundle carries', () => {
    // Renaming what is displayed must not cost the ability to search the old name.
    for (const card of bundle.cards) {
      expect(searchIndex(card)).toContain(card.name.toLowerCase());
    }
  });

  it('still matches costume titles', () => {
    const withTitle = bundle.cards.find((card) => card.title)!;
    expect(searchIndex(withTitle)).toContain(withTitle.title.toLowerCase());
  });
});

describe('branch labels', () => {
  it('shows the unit\'s English name rather than its katakana spelling', () => {
    expect(branchLabel('ゲーマーズ')).toBe('GAMERS');
  });

  it('leaves every other branch exactly as the data has it', () => {
    const relabelled = [...new Set(bundle.cards.map((card) => card.generation))]
      .filter((name) => branchLabel(name) !== name);
    expect(relabelled).toEqual(['ゲーマーズ']);
  });

  it('still filters and sorts on the stored value, not the label', () => {
    // The label is display only; the branch a card belongs to is unchanged.
    const gamers = bundle.cards.filter((card) => card.generation === 'ゲーマーズ');
    expect(gamers.length).toBeGreaterThan(0);
    expect(sortedGenerations(bundle.cards)).toContain('ゲーマーズ');
  });
});

describe('branch order', () => {
  it('derives the same order from card numbers as the written fallback', () => {
    // The snapshot carries no numbers, so first paint uses the written list and
    // the upstream refresh uses the data. If they disagreed the list would
    // visibly reshuffle a moment after load.
    const numbered: CardBundle = {
      ...bundle,
      cards: bundle.cards.map((card, index) => ({ ...card, cardNumber: NUMBERS[card.id] ?? index })),
    };
    indexMembers(numbered);
    const fromData = sortedGenerations(numbered.cards);
    indexMembers(bundle);
    expect(fromData).toEqual(GENERATION_ORDER.filter((name) => fromData.includes(name)));
  });

  it('lists the branches the way the game numbers them', () => {
    // Two of these were guessed wrong by hand before the card numbers were
    // found: ゲーマーズ formed before 2期生, and ReGLOSS is filed after EN.
    expect(sortedGenerations(bundle.cards)).toEqual([
      '0期生', '1期生', 'ゲーマーズ', '2期生', '3期生', '4期生', '5期生', 'holoX',
      'ID1期生', 'ID2期生', 'ID3期生',
      'Myth', 'Promise', 'Advent',
      'ReGLOSS',
    ]);
  });

  it('does not depend on the order the bundle happens to use', () => {
    const forwards = sortedGenerations(bundle.cards);
    const backwards = sortedGenerations([...bundle.cards].reverse());
    expect(backwards).toEqual(forwards);
  });

  it('knows every branch in the data', () => {
    const unknown = [...new Set(bundle.cards.map((card) => card.generation))]
      .filter((name) => !GENERATION_ORDER.includes(name));
    expect(unknown).toEqual([]);
  });

  it('orders the catalogue the same way the branch filter reads', () => {
    const sorted = [...bundle.cards].sort(compareCards);
    const branches = sorted.map((card) => card.generation);
    // Every branch appears as one unbroken run, in the filter's order.
    const runs = branches.filter((name, index) => name !== branches[index - 1]);
    expect(runs).toEqual([...new Set(runs)]);
    expect(runs).toEqual(sortedGenerations(bundle.cards));
  });

  it('keeps a member\'s costumes next to each other', () => {
    const sorted = [...bundle.cards].sort(compareCards);
    const swim = sorted.findIndex((card) => card.id.includes('_swim'));
    expect(swim).toBeGreaterThan(0);
    const base = sorted[swim].id.replace('_swim', '');
    expect(sorted[swim - 1].id).toBe(base);
  });

  it('sorts the same whatever order the bundle arrives in', () => {
    const forwards = [...bundle.cards].sort(compareCards).map((card) => card.id);
    const backwards = [...bundle.cards].reverse().sort(compareCards).map((card) => card.id);
    expect(backwards).toEqual(forwards);
  });

  it('puts an unknown branch last instead of scrambling the rest', () => {
    const invented = { generation: '7期生' } as CardJson;
    const shown = sortedGenerations([...bundle.cards, invented]);
    expect(shown[shown.length - 1]).toBe('7期生');
    expect(shown.slice(0, -1)).toEqual(sortedGenerations(bundle.cards));
    expect(compareGenerations('7期生', '0期生')).toBeGreaterThan(0);
  });
});
