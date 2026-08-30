/**
 * The Activation Frequency Up node recommendation.
 *
 * Three claims need pinning, and none of them can be checked against the module
 * itself. The interval rule is a community estimate, so it is tested against
 * the number the public tools produce. The staged search is an approximation of
 * the full 1024 x 120 sweep, so it is tested against that sweep. And the
 * assumed board is read off the master data, so the constant is tested against
 * the node values it is a sum of.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARRANGEMENT_COUNT, BASELINE_ACTIVATION_RATE, FREQUENCY_NODES, NODE_PERCENT,
  REORDER_DEPTH, effectiveInterval, factsForPlan, recommendFrequencyNodes,
} from '../src/engine/frequencyBoard';
import { bestOrder } from '../src/engine/compare';
import { materialize, prepare, projectedScore } from '../src/engine/chartScore';
import { cardFacts, outfitTable } from '../src/engine/precompute';
import type { CardBundle } from '../src/engine/types';
import type { ChartMeta, PreparedChart } from '../src/engine/chartScore';

interface ChartsBundle { charts: ChartMeta[]; index: Record<string, [number, number, number]> }

const dataUrl = (name: string) => new URL(`../public/data/${name}`, import.meta.url);
const bundle: CardBundle = JSON.parse(readFileSync(dataUrl('cards.json'), 'utf8'));
const chartsBundle: ChartsBundle = JSON.parse(readFileSync(dataUrl('charts.json'), 'utf8'));
const blobBytes = readFileSync(dataUrl('charts.bin'));
const blob = blobBytes.buffer.slice(blobBytes.byteOffset,
  blobBytes.byteOffset + blobBytes.byteLength);

const facts = cardFacts(bundle.cards, bundle.cards.map((c) => c.maxBloom));
const outfits = outfitTable(bundle.leaders, bundle.leaders.map((l) => l.maxBloom));
const payload = outfits.payloads[outfits.signatureOf[0]];
const members = [0, 1, 2, 3, 4];
const preparedFor = (key: string): PreparedChart => {
  const meta = chartsBundle.charts.find((c) => c.key === key)!;
  const [offset, count] = chartsBundle.index[key];
  return prepare(meta, materialize(blob, offset, count));
};
const expertBySize = chartsBundle.charts
  .filter((c) => c.difficulty === 'Expert')
  .sort((a, b) => (a.fullComboNoteCount ?? 0) - (b.fullComboNoteCount ?? 0));
/** Most room for the setting to matter. */
const longest = preparedFor(expertBySize[expertBySize.length - 1].key);

describe('the board this assumes', () => {
  it('carries three 4% nodes', () => {
    expect(FREQUENCY_NODES).toBe(3);
    expect(NODE_PERCENT).toBe(4);
    expect(ARRANGEMENT_COUNT).toBe(4 ** 5);
    expect(ARRANGEMENT_COUNT).toBe(1024);
  });

  it('assumes every Activation Rate node, which is what reaching them implies', () => {
    // The ten Activation Rate Up nodes on a holomem Board, from the master
    // data: one 6%, three 2%, six 3%. Three of the 3% ones gate the frequency
    // nodes; the rest are on the way.
    const board = [6, 2, 2, 2, 3, 3, 3, 3, 3, 3];
    expect(board.reduce((sum, value) => sum + value, 0)).toBe(BASELINE_ACTIVATION_RATE);
  });
});

describe('effective interval', () => {
  it('follows the community rule the public tools use', () => {
    // Hololive Dreams Lab: interval / (1 + rate/100), 4 points per node.
    expect(effectiveInterval(34, 0)).toBeCloseTo(34, 12);
    expect(effectiveInterval(34, 1)).toBeCloseTo(34 / 1.04, 12);
    expect(effectiveInterval(34, 2)).toBeCloseTo(34 / 1.08, 12);
    expect(effectiveInterval(34, 3)).toBeCloseTo(34 / 1.12, 12);
    // Deliberately NOT the cool-time-shorten reading. If this ever changes it
    // should be because someone measured the game, not by accident.
    expect(effectiveInterval(34, 3)).not.toBeCloseTo(34 * 0.88, 3);
  });

  it('shortens rather than lengthens, and leaves a dead skill alone', () => {
    expect(effectiveInterval(27, 3)).toBeLessThan(27);
    expect(effectiveInterval(0, 3)).toBe(0);
    expect(effectiveInterval(27, -1)).toBe(27);
  });
});

describe('factsForPlan', () => {
  it('shortens the named members and puts them all on the assumed board', () => {
    const out = factsForPlan(facts, members, [3, 0, 0, 0, 0]);
    expect(out).toHaveLength(facts.length);
    expect(out[0].activeInterval).toBeCloseTo(facts[0].activeInterval / 1.12, 12);
    expect(out[1].activeInterval).toBe(facts[1].activeInterval);
    for (const member of members) {
      expect(out[member].boardActivationRate).toBe(BASELINE_ACTIVATION_RATE);
    }
    // Nothing outside the five is touched, and nothing but those two fields is.
    for (let i = 5; i < facts.length; i++) expect(out[i]).toBe(facts[i]);
    expect({ ...out[0], activeInterval: facts[0].activeInterval, boardActivationRate: 0 })
      .toEqual(facts[0]);
  });

  it('leaves the caller array alone', () => {
    const before = facts[0].activeInterval;
    factsForPlan(facts, members, [3, 3, 3, 3, 3]);
    expect(facts[0].activeInterval).toBe(before);
    expect(facts[0].boardActivationRate).toBe(0);
  });
});

describe('the board Activation Rate reaches the score', () => {
  it('raises the projected score, and by more than compounding would', () => {
    const plain = projectedScore(facts, members, payload, longest).projectedScore;
    const boarded = projectedScore(factsForPlan(facts, members, [0, 0, 0, 0, 0]),
      members, payload, longest).projectedScore;
    expect(boarded).toBeGreaterThan(plain);
    // Summed with the Special windows' Rate Up rather than multiplied by it:
    // pre-scaling each probability instead would compound the two and read
    // higher, so a switch to that rule would fail here rather than pass quietly.
    const compounded = projectedScore(
      facts.map((row, i) => (members.includes(i)
        ? {
          ...row,
          activeProbability: Math.min(1, row.activeProbability
            * (1 + BASELINE_ACTIVATION_RATE / 100)),
        }
        : row)),
      members, payload, longest).projectedScore;
    expect(compounded).toBeGreaterThan(boarded);
  });
});

describe('recommendFrequencyNodes', () => {
  it('answers with a node count per member', () => {
    const nodes = recommendFrequencyNodes(facts, members, payload, longest);
    expect(nodes).toHaveLength(5);
    for (const count of nodes) {
      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(FREQUENCY_NODES);
    }
  });

  /** The full 1024 x 120 sweep this is an approximation of. */
  const exhaustive = (team: number[], chart: PreparedChart) => {
    let best: { score: number; plan: number[] } | null = null;
    for (let a = 0; a <= 3; a++) for (let b = 0; b <= 3; b++) for (let c = 0; c <= 3; c++)
      for (let d = 0; d <= 3; d++) for (let e = 0; e <= 3; e++) {
        const plan = [a, b, c, d, e];
        const score = bestOrder(factsForPlan(facts, team, plan),
          team, payload, chart, false).score;
        const nodes = (p: number[]) => p.reduce((sum, value) => sum + value, 0);
        if (!best || score > best.score
          || (score === best.score && nodes(plan) < nodes(best.plan))) best = { score, plan };
      }
    return best!;
  };

  it('re-searches enough of the ranking to be right', () => {
    // K was 32 on the strength of ten cases; over 400 it turned out to give a
    // wrong PLAN about once in twenty-five, at a score cost too small to notice
    // (0.47% at worst) and a plan difference large enough to matter. 128 was
    // 400/400. Anything that lowers this should have to say why here.
    expect(REORDER_DEPTH).toBe(128);
    expect(REORDER_DEPTH).toBeLessThan(ARRANGEMENT_COUNT);
  });

  it('finds what the full 1024 x 120 search finds, plan and score', () => {
    const truth = exhaustive(members, longest);
    const nodes = recommendFrequencyNodes(facts, members, payload, longest);
    expect(nodes).toEqual(truth.plan);
    expect(bestOrder(factsForPlan(facts, members, nodes),
      members, payload, longest, false).score).toBe(truth.score);
  }, 120000);

  it('agrees with the full search on every team and chart it is tried on', () => {
    // Four rather than the 400 the depth was chosen on: a full sweep costs
    // seconds, and this is here to catch a regression in the staged search, not
    // to re-derive K. The shortest and longest Expert charts, because the
    // number of activations that fit is what the approximation turns on.
    const charts = [expertBySize[0],
      expertBySize[expertBySize.length - 1]].map((c) => preparedFor(c.key));
    const teams = [[0, 1, 2, 3, 4], [20, 25, 30, 35, 40]];
    const wrong: string[] = [];
    for (const chart of charts) {
      for (const team of teams) {
        const truth = exhaustive(team, chart);
        const nodes = recommendFrequencyNodes(facts, team, payload, chart);
        const score = bestOrder(factsForPlan(facts, team, nodes),
          team, payload, chart, false).score;
        if (score !== truth.score) {
          wrong.push(`team ${team.join(',')}: ${nodes.join('/')} (${score})`
            + ` vs ${truth.plan.join('/')} (${truth.score})`);
        }
      }
    }
    expect(wrong, wrong.join('; ')).toEqual([]);
  }, 300000);

  it('answers a different question for a different song', () => {
    const short = preparedFor(expertBySize[0].key);
    const a = recommendFrequencyNodes(facts, members, payload, short);
    const b = recommendFrequencyNodes(facts, members, payload, longest);
    const scoreOn = (chart: PreparedChart, plan: number[]) =>
      bestOrder(factsForPlan(facts, members, plan), members, payload, chart, false).score;
    // The plans may legitimately coincide; the scores must not.
    expect(scoreOn(short, a)).not.toBe(scoreOn(longest, b));
  });

  it('does find teams where unlocking another node makes them worse', () => {
    // The premise of the whole feature. If a data change ever made more nodes
    // strictly better, the explanation printed beside the answer would be
    // misleading, and this failing is the right way to find that out.
    const charts = [expertBySize[0], expertBySize[Math.floor(expertBySize.length / 2)],
      expertBySize[expertBySize.length - 1]].map((c) => preparedFor(c.key));
    const teams = [[0, 1, 2, 3, 4], [10, 11, 12, 13, 14], [20, 25, 30, 35, 40]];
    let belowMax = 0;
    let worseWhenRaised = 0;
    for (const chart of charts) {
      for (const team of teams) {
        const nodes = recommendFrequencyNodes(facts, team, payload, chart);
        const best = bestOrder(factsForPlan(facts, team, nodes), team, payload, chart, false).score;
        nodes.forEach((count, member) => {
          if (count < FREQUENCY_NODES) belowMax++;
          for (let more = count + 1; more <= FREQUENCY_NODES; more++) {
            const raised = nodes.slice();
            raised[member] = more;
            const score = bestOrder(factsForPlan(facts, team, raised),
              team, payload, chart, false).score;
            if (score < best) worseWhenRaised++;
          }
        });
      }
    }
    expect(belowMax).toBeGreaterThan(0);
    expect(worseWhenRaised).toBeGreaterThan(0);
  }, 60000);
});
