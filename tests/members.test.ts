/**
 * Names and branch order, checked against the real bundle rather than a fixture,
 * so a data update that adds a member or a branch shows up here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GENERATION_ORDER, compareCards, compareGenerations, leaderName, memberName, searchIndex,
  sortedGenerations,
} from '../src/ui/members';
import type { CardBundle, CardJson } from '../src/engine/types';

const bundle: CardBundle = JSON.parse(
  readFileSync(new URL('../public/data/cards.json', import.meta.url), 'utf8'));

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

describe('branch order', () => {
  it('lists JP by debut, then ID, then EN', () => {
    const shown = sortedGenerations(bundle.cards);
    expect(shown[0]).toBe('0期生');
    expect(shown.indexOf('2期生')).toBeLessThan(shown.indexOf('3期生'));
    expect(shown.indexOf('ゲーマーズ')).toBeLessThan(shown.indexOf('3期生'));
    expect(shown.indexOf('holoX')).toBeLessThan(shown.indexOf('ReGLOSS'));
    expect(shown.indexOf('ReGLOSS')).toBeLessThan(shown.indexOf('ID1期生'));
    expect(shown.indexOf('ID3期生')).toBeLessThan(shown.indexOf('Myth'));
    expect(shown.indexOf('Myth')).toBeLessThan(shown.indexOf('Promise'));
    expect(shown.indexOf('Promise')).toBeLessThan(shown.indexOf('Advent'));
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
