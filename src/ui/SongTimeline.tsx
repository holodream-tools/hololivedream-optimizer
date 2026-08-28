/**
 * Where a team's strength actually happens.
 *
 * The averages say how strong a skill is; they cannot say whether it landed on
 * the busy half of the song or the quiet one, whether two Actives wasted each
 * other by overlapping, or why one standing order beats another. This draws the
 * windows the scoring pass itself used -- handed over in ChartMemberDetail, not
 * derived a second time -- against the chart's own density, so the picture and
 * the number can never tell different stories.
 *
 * Two density series, not one: note count and score weight. They come apart
 * exactly where it matters, because mid notes pay a tenth of a normal note and
 * the Combo Bonus grows through the song.
 */
import { chartDensity } from '../engine/chartScore';
import { attributeStyle } from './theme';
import type { CardJson } from '../engine/types';
import type { ChartMemberDetail, ChartScoreResult, PreparedChart } from '../engine/chartScore';
import { memberName } from './members';

/** viewBox units. The SVG scales; a min-width keeps it legible on a phone. */
const WIDTH = 1000;
const GUTTER = 132;
const RIGHT = 12;
const AXIS_H = 16;
const DENSITY_H = 62;
const ROW_H = 44;
const PLOT = WIDTH - GUTTER - RIGHT;

const SLOT_COLORS = ['#ec6ea8', '#f3a64c', '#79c56d', '#56b7e9', '#ac8bea'];

export interface SongTimelineProps {
  prepared: PreparedChart;
  detail: ChartScoreResult;
  /** The five cards in Special-slot order -- the standing order being drawn. */
  members: CardJson[];
}

const share = (value: number) => `${(value * 100).toFixed(1)}%`;

export function SongTimeline({ prepared, detail, members }: SongTimelineProps) {
  const rows = detail.members;
  if (!rows || !rows.length || !prepared.times.length) return null;

  const first = prepared.times[0];
  const span = Math.max(prepared.lastTime - first, 1e-9);
  const x = (seconds: number) => GUTTER + ((seconds - first) / span) * PLOT;
  const clamp = (seconds: number) => Math.min(Math.max(seconds, first), first + span);

  // One bucket per ~1.5 viewBox units: fine enough to show a burst, coarse
  // enough that the browser is not drawing a rectangle per note.
  const buckets = chartDensity(prepared, detail.perfectNoteScore, 140);
  const peakNotes = Math.max(1, ...buckets.map((b) => b.notes));
  const peakWeight = Math.max(1, ...buckets.map((b) => b.weight));

  const height = AXIS_H + DENSITY_H + rows.length * ROW_H + 10;
  const densityTop = AXIS_H + 4;
  const densityBase = densityTop + DENSITY_H - 14;
  const rowTop = (index: number) => AXIS_H + DENSITY_H + index * ROW_H;

  // A tick every 10 s while that stays readable, then every 20 or 30.
  const step = span > 240 ? 30 : span > 150 ? 20 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= span; t += step) ticks.push(first + t);

  return (
    <div className="timeline">
      <div className="timeline-scroll">
        <svg viewBox={`0 0 ${WIDTH} ${height}`} className="timeline-svg"
             role="img" aria-label="技能時間軸">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={x(tick)} y1={AXIS_H - 4} x2={x(tick)} y2={height - 8}
                    className="tl-grid" />
              <text x={x(tick) + 3} y={11} className="tl-tick">
                {Math.round(tick - first)}s
              </text>
            </g>
          ))}

          <text x={4} y={densityBase - 20} className="tl-label">音符密度</text>
          <text x={4} y={densityBase - 8} className="tl-sublabel">柱＝音符數</text>
          <text x={4} y={densityBase + 4} className="tl-sublabel">線＝分數重量</text>
          {buckets.map((bucket, index) => {
            const barWidth = Math.max(1, x(bucket.end) - x(bucket.start));
            const barHeight = (bucket.notes / peakNotes) * (DENSITY_H - 20);
            return (
              <rect key={index} x={x(bucket.start)} y={densityBase - barHeight}
                    width={barWidth} height={barHeight} className="tl-density" />
            );
          })}
          {/* The score-weight line rides over the count bars: where it sags
              under a tall bar, those notes are cheap. */}
          <polyline className="tl-weight" points={buckets.map((bucket) =>
            `${x((bucket.start + bucket.end) / 2)},`
            + `${densityBase - (bucket.weight / peakWeight) * (DENSITY_H - 20)}`).join(' ')} />
          <line x1={GUTTER} y1={densityBase} x2={WIDTH - RIGHT} y2={densityBase} className="tl-base" />

          {rows.map((row: ChartMemberDetail, index: number) => {
            const card = members[index];
            const top = rowTop(index);
            const color = SLOT_COLORS[index % SLOT_COLORS.length];
            const special = row.specialWindow;
            const specialWidth = Math.max(2, x(clamp(special.end)) - x(clamp(special.start)));
            return (
              <g key={index}>
                {/* The row is the member standing in this slot -- both their
                     Special and their Active -- so it is named for the slot,
                     not for one of the two skills in it. */}
                <text x={4} y={top + 15} className="tl-slot" fill={color}>
                  站位 {index + 1}
                </text>
                <text x={4} y={top + 27} className="tl-name">
                  {card ? memberName(card) : '—'}
                </text>
                <line x1={GUTTER} y1={top + ROW_H - 4} x2={WIDTH - RIGHT} y2={top + ROW_H - 4}
                      className="tl-rowline" />

                {/* Active first, so the Special reads on top of it where they meet. */}
                {row.activeWindows.map((window, w) => (
                  <rect key={w} x={x(clamp(window.start))} y={top + 16}
                        width={Math.max(2, x(clamp(window.end)) - x(clamp(window.start)))}
                        height={13} rx={2} fill={color}
                        opacity={0.2 + 0.55 * window.probability}>
                    <title>
                      {`Active ${window.start.toFixed(1)}–${window.end.toFixed(1)}s`
                        + ` · 發動機率 ${(window.probability * 100).toFixed(0)}%`
                        + ` · +${window.scoreUp.toFixed(0)}%`}
                    </title>
                  </rect>
                ))}
                <rect x={x(clamp(special.start))} y={top + 4} width={specialWidth} height={9}
                      rx={2} fill={color} className="tl-special">
                  <title>
                    {`Special ${special.start.toFixed(1)}–${special.end.toFixed(1)}s`
                      + ` · Score Support +${row.specialSupport.toFixed(0)}`
                      + (row.specialRate ? ` · SAR +${row.specialRate.toFixed(0)}` : '')}
                  </title>
                </rect>
              </g>
            );
          })}
        </svg>
      </div>

      <p className="timeline-legend">
        上排短條＝Special 持續時間，下排長條＝Active 可發動時間（越實心表示發動機率越高）。
        兩條在同一時間重疊，代表那段時間的加成互相疊在同一批音符上。
      </p>

      <div className="cmp-scroll">
        <table className="cmp-table timeline-table">
          <colgroup>
            <col className="tl-col-slot" /><col className="tl-col-name" />
            <col className="tl-col-skill" /><col className="tl-col-skill" />
            <col className="tl-col-cov" /><col className="tl-col-cov" />
            <col className="tl-col-score" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">站位</th><th scope="col">成員</th>
              <th scope="col">Special</th><th scope="col">Active</th>
              <th scope="col">時間覆蓋</th><th scope="col">音符覆蓋</th>
              <th scope="col" className="tl-th-score">分數覆蓋</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: ChartMemberDetail, index: number) => {
              const card = members[index];
              const style = card ? attributeStyle(card.type) : null;
              // Score above notes means the window sat on expensive notes; below
              // means it caught a lot of cheap ones.
              const lift = row.activeNoteCoverage
                ? row.activeScoreCoverage / row.activeNoteCoverage - 1 : 0;
              return (
                <tr key={index}>
                  <th scope="row" style={style ? { color: SLOT_COLORS[index % 5] } : undefined}>
                    {index + 1}
                  </th>
                  <td className="tl-cell-name">{card ? memberName(card) : '—'}</td>
                  <td>
                    {row.specialWindow.start.toFixed(0)}–{row.specialWindow.end.toFixed(0)}s
                    {row.specialSupport ? ` · +${row.specialSupport.toFixed(0)}` : ''}
                  </td>
                  <td>{row.activeWindows.length} 次 · +{row.activeScoreUp.toFixed(0)}%</td>
                  <td>{share(row.activeTimeCoverage)}</td>
                  <td>{share(row.activeNoteCoverage)}</td>
                  <td>
                    <span className="tl-cov">
                      <span>{share(row.activeScoreCoverage)}</span>
                      {Math.abs(lift) > 0.05 && (
                        <span className={`tl-lift ${lift > 0 ? 'is-up' : 'is-down'}`}
                              title={lift > 0
                                ? '蓋到的音符比平均值錢'
                                : '蓋到的音符比平均便宜'}>
                          <i>{lift > 0 ? '↑' : '↓'}</i>{Math.abs(lift * 100).toFixed(0)}%
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="metric-note">
        分數覆蓋旁的箭頭是它與音符覆蓋的落差：↑ 表示這段技能蓋到的音符比平均值錢，↓ 表示雖然蓋到很多音符，但那些音符不值錢。
      </p>
    </div>
  );
}
