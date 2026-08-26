/**
 * Perfect-FC projected score for a selected chart.
 *
 * Port of app/engine/chart_score.py. Scoring is evaluated per SEGMENT rather
 * than per note: the multiplier applied to a note only changes where a skill
 * window opens or closes -- about 60 boundaries per song against 78-2022 notes.
 *
 * EXACTNESS: mathematically equal to the reference, but the notes are summed in
 * a different association order, so the final floor() can differ by one point.
 * The Python engine already carries this caveat; the parity test measures the
 * real rate rather than assuming it is zero.
 */
import { expectedMaximum } from './active';
import { leaderPowerAndSupport, makeMemberState, memberPart } from './overallScore';
import type { CardFacts, OutfitPayload } from './types';
import type { MemberState } from './overallScore';

/** Used only when a newly added chart has no public per-chart ratio yet. */
export const FALLBACK_PLAIN_AP_MULTIPLIER = 2.3;

export interface ChartMeta {
  key: string;
  musicId?: string;
  title?: string;
  difficulty?: string;
  difficultyLevel?: number;
  scoreRatioEstimated?: number | null;
  fullComboNoteCount?: number;
  playingSeconds?: number;
}

export interface ChartTimeline {
  times: Float64Array;
  weights: Float64Array;
  specialTimes: Float64Array;
}

/** Chart-only data: independent of the team and of the standing order. */
export interface PreparedChart {
  times: Float64Array;
  midPrefix: Float64Array;
  normalPrefix: Float64Array;
  specialTimes: Float64Array;
  scoreRatio: number;
  ratioSource: string;
  lastTime: number;
}

/** Convert the compact chart weight to the game's per-note scale. */
function noteScale(weight: number): number {
  return weight < 200 ? weight / 100 : weight / 1000;
}

/**
 * Decode one chart from the packed blob.
 * Each note is `<HH>`: a uint16 millisecond delta and a doubled uint16 weight.
 * Five uint32 Special timestamps follow.
 */
export function materialize(blob: ArrayBuffer, offset: number, count: number): ChartTimeline {
  const view = new DataView(blob);
  const times = new Float64Array(count);
  const weights = new Float64Array(count);
  let position = offset;
  let timeMs = 0;
  for (let i = 0; i < count; i++) {
    timeMs += view.getUint16(position, true);
    weights[i] = view.getUint16(position + 2, true) / 2;
    times[i] = timeMs / 1000;
    position += 4;
  }
  const specialTimes = new Float64Array(5);
  for (let i = 0; i < 5; i++) specialTimes[i] = view.getUint32(position + i * 4, true) / 1000;
  return { times, weights, specialTimes };
}

export function prepare(chart: ChartMeta, timeline: ChartTimeline): PreparedChart {
  const count = timeline.times.length;
  const midPrefix = new Float64Array(count + 1);
  const normalPrefix = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) {
    const weight = timeline.weights[i];
    const scale = noteScale(weight);
    const isMid = weight < 200;
    midPrefix[i + 1] = midPrefix[i] + (isMid ? scale : 0);
    normalPrefix[i + 1] = normalPrefix[i] + (isMid ? 0 : scale);
  }
  let ratio = Number(chart.scoreRatioEstimated ?? 0);
  let ratioSource: string;
  if (ratio > 0) {
    ratioSource = 'Hololive Dreams Lab estimated chart ratio';
  } else {
    ratio = Math.max((midPrefix[count] + normalPrefix[count]) / FALLBACK_PLAIN_AP_MULTIPLIER, 1e-9);
    ratioSource = 'local note-weight fallback';
  }
  return {
    times: timeline.times, midPrefix, normalPrefix,
    specialTimes: timeline.specialTimes, scoreRatio: ratio, ratioSource,
    lastTime: count > 0 ? timeline.times[count - 1] : 0,
  };
}

/** Index of the first time >= value, i.e. Python's bisect_left. */
function bisectLeft(times: Float64Array, value: number, hi: number): number {
  let lo = 0;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < value) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function conditionMet(condition: unknown, rows: CardFacts[], combo: number): boolean {
  if (!condition) return true;
  const value = String(condition).toLowerCase();
  if (value.startsWith('combo_')) return combo >= Number(value.slice(value.lastIndexOf('_') + 1));
  // The chart model is explicitly a Perfect-FC model at full Life.
  if (value.startsWith('life_')) return Number(value.slice(value.lastIndexOf('_') + 1)) <= 1000;
  if (value.endsWith('_2')) {
    const attribute = value.slice(0, -2);
    let matches = 0;
    for (const row of rows) if (row.type === attribute) matches++;
    return matches >= 2;
  }
  return false;
}

export interface ChartScoreResult {
  projectedScore: number;
  totalPower: number;
  perfectNoteScore: number;
  scoreRatio: number;
  ratioSource: string;
  activeBonus: number;
}

export function projectedScore(
  facts: CardFacts[], memberIndices: ArrayLike<number>,
  outfitPayload: OutfitPayload | null, prepared: PreparedChart,
  state?: MemberState,
): ChartScoreResult {
  const working = state ?? makeMemberState();
  if (!state) memberPart(facts, memberIndices, working);
  const rows: CardFacts[] = [];
  for (let i = 0; i < 5; i++) rows.push(facts[memberIndices[i]]);

  const [totalPower, leaderSupport] = leaderPowerAndSupport(outfitPayload, working);
  const times = prepared.times;
  const noteCount = times.length;
  const empty: ChartScoreResult = {
    projectedScore: 0, totalPower, perfectNoteScore: 0,
    scoreRatio: prepared.scoreRatio, ratioSource: prepared.ratioSource, activeBonus: 0,
  };
  if (noteCount === 0 || totalPower <= 0) return empty;

  const perfect = Math.max(1, Math.floor(totalPower / prepared.scoreRatio));
  if (perfect <= 0) return empty;
  const midValue = Math.ceil(perfect * 0.1);

  // Special windows: member i takes the i-th Special slot.
  const specialStart = new Float64Array(5), specialEnd = new Float64Array(5);
  const specialSupport = new Float64Array(5), specialRate = new Float64Array(5);
  for (let i = 0; i < 5; i++) {
    const row = rows[i];
    const start = prepared.specialTimes[i];
    const comboBefore = bisectLeft(times, start, noteCount);
    specialStart[i] = start;
    specialEnd[i] = start + row.specialDuration;
    specialSupport[i] = row.specialScoreSupport;
    specialRate[i] = conditionMet(row.specialRateCondition, rows, comboBefore) ? row.specialSkillRateUp : 0;
  }

  // Active windows: one check every `interval` seconds, up to the last note.
  const activeWindows: Array<Float64Array[]> = [];
  for (let i = 0; i < 5; i++) {
    const row = rows[i];
    const starts: number[] = [], ends: number[] = [], magnitudes: number[] = [], probabilities: number[] = [];
    const interval = row.activeInterval, duration = row.activeDuration;
    let check = interval;
    while (interval > 0 && duration > 0 && check <= prepared.lastTime) {
      const comboBefore = bisectLeft(times, check, noteCount);
      let rate = 0;
      for (let s = 0; s < 5; s++) if (specialStart[s] <= check && check < specialEnd[s]) rate += specialRate[s];
      let magnitude = row.activeScoreUp;
      if (row.activeConditionalScoreUp !== null && conditionMet(row.activeCondition, rows, comboBefore)) {
        magnitude = row.activeConditionalScoreUp;
      }
      starts.push(check); ends.push(check + duration);
      magnitudes.push(magnitude);
      probabilities.push(Math.min(1, row.activeProbability * (1 + rate / 100)));
      check += interval;
    }
    activeWindows.push([
      Float64Array.from(starts), Float64Array.from(ends),
      Float64Array.from(magnitudes), Float64Array.from(probabilities),
    ]);
  }

  // The multiplier only changes where a window opens or closes.
  const boundarySet = new Set<number>([0]);
  for (let i = 0; i < 5; i++) { boundarySet.add(specialStart[i]); boundarySet.add(specialEnd[i]); }
  for (const [starts, ends] of activeWindows) {
    for (let i = 0; i < starts.length; i++) { boundarySet.add(starts[i]); boundarySet.add(ends[i]); }
  }
  const lastNote = times[noteCount - 1];
  const edges = [...boundarySet].filter((t) => t <= lastNote).sort((a, b) => a - b);

  const effectValues = new Float64Array(5), effectProbabilities = new Float64Array(5);
  let weightedTotal = 0, baselineScore = 0;
  for (let position = 0; position < edges.length; position++) {
    const low = edges[position];
    const high = position + 1 < edges.length ? edges[position + 1] : null;
    const first = bisectLeft(times, low, noteCount);
    const last = high === null ? noteCount : bisectLeft(times, high, noteCount);
    if (last <= first) continue;

    const base = midValue * (prepared.midPrefix[last] - prepared.midPrefix[first])
      + perfect * (prepared.normalPrefix[last] - prepared.normalPrefix[first]);
    let support = 0;
    for (let s = 0; s < 5; s++) if (specialStart[s] <= low && low < specialEnd[s]) support += specialSupport[s];

    let effectCount = 0;
    for (let i = 0; i < 5; i++) {
      const [starts, ends, magnitudes, probabilities] = activeWindows[i];
      let misses = 1, magnitude = 0;
      for (let w = 0; w < starts.length; w++) {
        if (starts[w] <= low && low < ends[w]) {
          misses *= 1 - probabilities[w];
          if (magnitudes[w] > magnitude) magnitude = magnitudes[w];
        }
      }
      if (magnitude > 0 && misses < 1) {
        // One scoring event uses one Score Support total, not a per-member share.
        const total = working.staticSupport + leaderSupport + support;
        effectValues[effectCount] = magnitude * (1 + total / 100);
        effectProbabilities[effectCount] = 1 - misses;
        effectCount++;
      }
    }
    baselineScore += base;
    weightedTotal += base * (1 + expectedMaximum(effectValues, effectProbabilities, effectCount) / 100);
  }

  return {
    projectedScore: Math.floor(weightedTotal),
    totalPower,
    perfectNoteScore: perfect,
    scoreRatio: prepared.scoreRatio,
    ratioSource: prepared.ratioSource,
    activeBonus: baselineScore ? (weightedTotal / baselineScore - 1) * 100 : 0,
  };
}
