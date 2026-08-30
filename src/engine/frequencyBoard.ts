/**
 * How many Activation Frequency Up nodes each member should unlock.
 *
 * THE BOARD. A holomem Board carries three Activation Frequency Up nodes, 4%
 * each. Read off the master data's own grid, each of the three is a dead end
 * whose only neighbour is an Activation Rate Up node, so a frequency node
 * cannot be reached without it; a board far enough along to be choosing between
 * them is already carrying every Activation Rate node, +30% in total. That is
 * the baseline this module assumes, and the page says so above the answer.
 *
 * So a member has four settings -- nought to three nodes -- and a team of five
 * has 4^5 = 1024 arrangements, scored on the real chart engine rather than on a
 * coverage proxy: what a node is worth depends on where the notes are, how far
 * the Combo Bonus has grown by then, and whether the window it opens lands
 * under a stronger one.
 *
 * WHY MORE IS NOT ALWAYS BETTER. Shortening the interval MOVES every check --
 * the k-th slides from k*I to k*I' -- and on some songs fits one more in before
 * the last note. Both help and both hurt: a window that used to cover a gap can
 * slide under a team-mate's stronger window, where it earns nothing, because
 * Active effects do not stack and only the largest one that fires applies. An
 * extra activation is worth little if it lands where somebody else was already
 * covering. Sampled across teams and charts, unlocking one more node lowers the
 * projected score about 44% of the time.
 *
 * The Activation Rate nodes are a different matter and are NOT optimised here:
 * raising an activation probability moves no window, so it can only raise the
 * expected maximum. Measured over 243 samples it never once lowered the score,
 * which matches the algebra. There is nothing to decide about them.
 *
 * THE INTERVAL RULE IS A COMMUNITY ESTIMATE, NOT A PUBLISHED FORMULA. The game
 * shows "Activation Frequency UP 4%" while the master data calls the effect a
 * cool-time shorten of 40 permil. Every public tool -- Hololive Dreams Lab,
 * horodori.com, the skill-coverage and timeline tools -- reads that as
 * `interval / (1 + percent/100)`, and this module follows them so its numbers
 * can be compared with theirs. The other reading, `interval * (1 -
 * percent/100)`, is what the field name suggests and differs by 0.44 s on a
 * 34 s skill. No one has published an in-game measurement settling it, so the
 * page labels the result an estimate.
 *
 * Connect cards can raise a node above 4%; that is deliberately not modelled,
 * so a player using them sees a slightly conservative answer.
 */
import { bestOrder } from './compare';
import { projectedScore } from './chartScore';
import type { PreparedChart } from './chartScore';
import type { CardFacts, OutfitPayload } from './types';

/** Activation Frequency Up nodes on one holomem Board. */
export const FREQUENCY_NODES = 3;

/** What one of them is worth, in percentage points. */
export const NODE_PERCENT = 4;

/**
 * Activation Rate Up already standing when this question is worth asking.
 *
 * Every Activation Rate node on the board: 6 + 2 + 2 + 2 + 3 + 3 + 3 + 3 + 3 +
 * 3. Three of those (the 3% ones next to each frequency node) are the gates,
 * and the rest sit on the way to them.
 */
export const BASELINE_ACTIVATION_RATE = 30;

/** How many arrangements a five-member team has. */
export const ARRANGEMENT_COUNT = (FREQUENCY_NODES + 1) ** 5;

/**
 * How many of the fixed-order leaders get their standing order re-searched.
 *
 * Ranking all 1024 on one fixed order is cheap but approximate: a fixed-order
 * score is a lower bound, since an arrangement can only do better with its own
 * best order. Re-running the 120-order search on the top K recovers the true
 * winner, and K decides how often it really does.
 *
 * Measured against the full 1024 x 120 search over 400 cases -- two independent
 * batches of 200 random team-chart-Outfit combinations, 339 distinct charts,
 * 91 to 1777 notes:
 *
 *   K=16    93.0%   (one batch)
 *   K=32    96.0%   384/400
 *   K=64    99.25%  397/400
 *   K=128  100.0%   400/400          <- chosen
 *   K=256  100.0%   (one batch)
 *
 * K=32 was picked originally on ten cases, which was too small a sample to see
 * that it gives a wrong answer about once in twenty-five.
 *
 * The score gap on a miss is small -- at most 0.47% -- but that is the wrong
 * thing to read. Near the top the surface is almost flat, so a plan 0.3% off
 * can differ on every one of the five members (3/0/0/3/2 against 0/2/3/0/0 in
 * the worst case seen), and the page prints the plan rather than the score. The
 * plan has to be right, which is what buys the extra work.
 *
 * 400/400 is a measurement, not a proof: a fixed-order score being a lower
 * bound means any K below 1024 can in principle miss. Full exhaustion costs
 * about 2.1 s a case against 280 ms here, and this runs deferred, behind a
 * result the player already has.
 */
export const REORDER_DEPTH = 128;

/** The community-estimated effective interval. See the file comment. */
export function effectiveInterval(baseSeconds: number, nodes: number): number {
  if (!(baseSeconds > 0)) return 0;
  return baseSeconds / (1 + (Math.max(0, nodes) * NODE_PERCENT) / 100);
}

/**
 * A copy of `facts` with the five members put on the board this module assumes.
 *
 * Their Active intervals shorten by however many nodes each is given, and all
 * five carry the baseline Activation Rate that reaching those nodes implies.
 * Only the five entries are replaced, so the array keeps its indices and the
 * scorer needs no other change.
 */
export function factsForPlan(
  facts: CardFacts[], members: ArrayLike<number>, nodes: ArrayLike<number>,
): CardFacts[] {
  const out = facts.slice();
  for (let i = 0; i < members.length; i++) {
    const row = facts[members[i]];
    out[members[i]] = {
      ...row,
      activeInterval: effectiveInterval(row.activeInterval, nodes[i]),
      boardActivationRate: BASELINE_ACTIVATION_RATE,
    };
  }
  return out;
}

/** Every arrangement, fewest nodes first so a tie keeps the cheaper plan. */
function everyArrangement(): number[][] {
  const out: number[][] = [];
  const current = new Array<number>(5).fill(0);
  const walk = (slot: number) => {
    if (slot === 5) { out.push(current.slice()); return; }
    for (let n = 0; n <= FREQUENCY_NODES; n++) { current[slot] = n; walk(slot + 1); }
  };
  walk(0);
  return out;
}

const ARRANGEMENTS = everyArrangement();

/**
 * How many Activation Frequency Up nodes each member should unlock, for this
 * team on this chart. One entry per member, 0 to FREQUENCY_NODES.
 *
 * Two passes: rank all 1024 on the order the team already prefers, then
 * re-search the standing order for the best REORDER_DEPTH of them and take the
 * winner. Ties go to the arrangement that unlocks fewer nodes, since a node
 * costs skill tree points and cubes that a tied plan does not need to spend.
 */
export function recommendFrequencyNodes(
  facts: CardFacts[], members: number[], payload: OutfitPayload | null,
  prepared: PreparedChart,
): number[] {
  const baseline = factsForPlan(facts, members, [0, 0, 0, 0, 0]);
  const fixedOrder = bestOrder(baseline, members, payload, prepared, false).order;
  const ranked = ARRANGEMENTS.map((nodes, index) => ({
    index,
    score: projectedScore(factsForPlan(facts, members, nodes), fixedOrder,
      payload, prepared).projectedScore,
  }));
  ranked.sort((a, b) => b.score - a.score);

  const nodesIn = (arrangement: number[]) => arrangement.reduce((sum, n) => sum + n, 0);
  let best = { score: -Infinity, index: 0 };
  for (const row of ranked.slice(0, REORDER_DEPTH)) {
    const score = bestOrder(factsForPlan(facts, members, ARRANGEMENTS[row.index]),
      members, payload, prepared, false).score;
    if (score > best.score
      || (score === best.score
        && nodesIn(ARRANGEMENTS[row.index]) < nodesIn(ARRANGEMENTS[best.index]))) {
      best = { score, index: row.index };
    }
  }
  return ARRANGEMENTS[best.index].slice();
}
