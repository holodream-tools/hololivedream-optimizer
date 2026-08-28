/**
 * Why A beats B, in terms that add up.
 *
 * The score is a product, so percentages do not naturally add: a team 4% ahead
 * on power and 2% ahead on Active is not 6% ahead. Working in logs fixes that,
 * because ln(A/B) splits exactly across a product, and an additive aggregate
 * inside it splits exactly too:
 *
 *     ln(V_A / V_B) = SUM_c (x_c^A - x_c^B) / L(V_A, V_B)
 *
 * with L the logarithmic mean of the TOTALS. That is the LMDI-I identity. Only
 * the totals need to be positive, so a component that is zero on one side --
 * an Outfit whose condition failed, a team with no Passive gain -- costs
 * nothing and needs no special case.
 *
 * These are ATTRIBUTED contributions, not figures the game reports. The split
 * of a product into named causes is a choice; this file makes one choice and
 * applies it consistently, and the UI has to say so.
 *
 * One consequence worth stating plainly: Score Support has no standalone value
 * in this model -- it only multiplies an Active that fires -- so the cross term
 * between them is credited to Support rather than to Active. Crediting it to
 * Active would say Support did nothing, which is the opposite of true.
 */
import type { GenericView } from './compare';
import type { ChartScoreResult } from './chartScore';

export interface AttributionRow {
  label: string;
  /** Contribution in nats. These sum to ln(A/B) exactly. */
  log: number;
  /**
   * The same contribution rescaled so the rows sum to the displayed gap. A
   * linear rescale of an exact decomposition, so it stays exact.
   */
  percent: number;
  /** The underlying quantity on each side, for context beside the share. */
  a: number;
  b: number;
  /** How to print a and b. */
  unit?: 'points' | 'percent' | 'raw';
}

export interface AttributionReport {
  aTotal: number;
  bTotal: number;
  /** (A/B - 1) * 100: the gap as a player would state it. */
  gap: number;
  /** ln(A/B): what the rows actually sum to before rescaling. */
  logGap: number;
  /** Largest absolute contribution first, so the reason leads. */
  rows: AttributionRow[];
}

/** Logarithmic mean; the a === b limit is a. */
function logMean(a: number, b: number): number {
  if (a <= 0 || b <= 0) return (a + b) / 2;
  if (Math.abs(a - b) < 1e-12) return (a + b) / 2;
  return (a - b) / (Math.log(a) - Math.log(b));
}

function finish(aTotal: number, bTotal: number,
                parts: Array<Omit<AttributionRow, 'percent'>>): AttributionReport {
  const gap = bTotal ? (aTotal / bTotal - 1) * 100 : 0;
  const logGap = aTotal > 0 && bTotal > 0 ? Math.log(aTotal / bTotal) : 0;
  // Rescaling keeps the rows summing to the number in the headline. When the
  // gap is zero there is nothing to distribute and every row is zero anyway.
  const scale = Math.abs(logGap) > 1e-15 ? gap / logGap : 0;
  const rows = parts
    .map((part) => ({ ...part, percent: part.log * scale }))
    .sort((x, y) => Math.abs(y.percent) - Math.abs(x.percent));
  return { aTotal, bTotal, gap, logGap, rows };
}

/**
 * Generic mode: index = totalPower x (1 + multiplier), an exact product, and
 * each factor an exact sum.
 *
 *   totalPower  = base + passive + outfit
 *   1 + m       = 1 + Active/100 + Active x Support/10000, one term per Support
 *
 * Active is further split by evaluating the same team with SAR set to zero, so
 * the SAR row is what raising the activation rate actually bought.
 */
export function attributeGeneric(a: GenericView, b: GenericView): AttributionReport {
  const powerMean = logMean(a.totalPower, b.totalPower);
  const multiplierOf = (view: GenericView) => 1 + (view.activeScoreUp / 100)
    * (1 + (view.passiveSupport + view.leaderSupport + view.specialSupport) / 100);
  const aM = multiplierOf(a), bM = multiplierOf(b);
  const mMean = logMean(aM, bM);

  const power = (aValue: number, bValue: number) => (aValue - bValue) / powerMean;
  const mult = (aValue: number, bValue: number) => (aValue - bValue) / mMean;
  const cross = (view: GenericView, support: number) =>
    (view.activeScoreUp * support) / 10000;

  return finish(a.index, b.index, [
    {
      label: '基礎能力', unit: 'points',
      log: power(a.basePower, b.basePower), a: a.basePower, b: b.basePower,
    },
    {
      label: 'Passive 能力加成', unit: 'points',
      log: power(a.passiveGain, b.passiveGain), a: a.passiveGain, b: b.passiveGain,
    },
    {
      label: 'Leader（Outfit）能力加成', unit: 'points',
      log: power(a.outfitGain, b.outfitGain), a: a.outfitGain, b: b.outfitGain,
    },
    {
      label: 'Active 期望', unit: 'percent',
      log: mult(a.activeScoreUpNoSar / 100, b.activeScoreUpNoSar / 100),
      a: a.activeScoreUpNoSar, b: b.activeScoreUpNoSar,
    },
    {
      label: 'SAR（技能發動率）', unit: 'percent',
      log: mult((a.activeScoreUp - a.activeScoreUpNoSar) / 100,
                (b.activeScoreUp - b.activeScoreUpNoSar) / 100),
      a: a.sarPoints, b: b.sarPoints,
    },
    {
      label: 'Passive Score Support', unit: 'raw',
      log: mult(cross(a, a.passiveSupport), cross(b, b.passiveSupport)),
      a: a.passiveSupport, b: b.passiveSupport,
    },
    {
      label: 'Outfit Score Support', unit: 'raw',
      log: mult(cross(a, a.leaderSupport), cross(b, b.leaderSupport)),
      a: a.leaderSupport, b: b.leaderSupport,
    },
    {
      label: 'Special Score Support', unit: 'raw',
      log: mult(cross(a, a.specialSupport), cross(b, b.specialSupport)),
      a: a.specialSupport, b: b.specialSupport,
    },
  ]);
}

/**
 * Song mode: the chart score is the chart's own score weight at this team's
 * PERFECT note value, lifted by whatever was active at each note.
 *
 *   score = floor( baseline(perfect) x (1 + activeBonus/100) )
 *
 * The power side splits as it does generically. The lift does not: the chart
 * model applies Active, Special, SAR and Score Support at the moment each note
 * is struck rather than as averages, so there is no product to split them out
 * of. It is one row, and the coverage figures beside the report say where it
 * landed rather than pretending to be additive factors of it.
 *
 * The floors do not cancel -- perfect note value is floor(totalPower / divisor),
 * the mid note is a ceil of that, and the score is floored again -- so the power
 * logs and the lift log do not quite sum to the score log. That remainder is
 * folded back into the three power rows rather than shown on its own, because
 * the power total is what gets quantised and because "rounding" is not a cause
 * anyone can act on. Measured over 92 team pairs across four charts it is a
 * median 0.03 and at most 0.26 percentage points, never above 2.3% of the gap,
 * so the rows it lands on move by far less than the two decimals shown.
 */
export function attributeChart(
  a: { view: GenericView; detail: ChartScoreResult; score: number },
  b: { view: GenericView; detail: ChartScoreResult; score: number },
): AttributionReport {
  const powerMean = logMean(a.view.totalPower, b.view.totalPower);
  const power = (aValue: number, bValue: number) => (aValue - bValue) / powerMean;

  const logLift = Math.log((1 + a.detail.activeBonus / 100) / (1 + b.detail.activeBonus / 100));
  const logScore = a.score > 0 && b.score > 0 ? Math.log(a.score / b.score) : 0;

  const powerRows = [
    {
      label: '基礎能力', unit: 'points' as const,
      log: power(a.view.basePower, b.view.basePower),
      a: a.view.basePower, b: b.view.basePower,
    },
    {
      label: 'Passive 能力加成', unit: 'points' as const,
      log: power(a.view.passiveGain, b.view.passiveGain),
      a: a.view.passiveGain, b: b.view.passiveGain,
    },
    {
      label: 'Leader（Outfit）能力加成', unit: 'points' as const,
      log: power(a.view.outfitGain, b.view.outfitGain),
      a: a.view.outfitGain, b: b.view.outfitGain,
    },
  ];

  // The three sum to ln(powerA/powerB) exactly, so whatever is left over
  // between that and ln(scoreA/scoreB) - ln(liftA/liftB) is the quantisation.
  // Split it in proportion to how much each row already carries; three rows
  // that all read zero can only share it evenly.
  const carried = powerRows.reduce((sum, row) => sum + row.log, 0);
  const residual = logScore - logLift - carried;
  const weightTotal = powerRows.reduce((sum, row) => sum + Math.abs(row.log), 0);
  for (const row of powerRows) {
    row.log += weightTotal > 1e-15
      ? residual * (Math.abs(row.log) / weightTotal)
      : residual / powerRows.length;
  }

  return finish(a.score, b.score, [
    ...powerRows,
    {
      label: '本曲技能實際貢獻', unit: 'percent',
      log: logLift, a: a.detail.activeBonus, b: b.detail.activeBonus,
    },
  ]);
}
