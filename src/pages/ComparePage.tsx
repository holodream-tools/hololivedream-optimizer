/**
 * 隊伍比較 — two teams side by side, every figure from the ranking engine.
 *
 * The page never computes a number of its own: it calls the same functions the
 * sweep and the song page call, so a row here can never disagree with the
 * leaderboard the teams came from.
 */
import { useMemo, useState } from 'react';
import {
  bestOrder, genericView, leaveOneOutChart, leaveOneOutGeneric, singleDifference,
} from '../engine/compare';
import { attributeChart, attributeGeneric } from '../engine/attribution';
import { materialize, prepare } from '../engine/chartScore';
import { cardFacts, outfitTable } from '../engine/precompute';
import { attributeStyle } from '../ui/theme';
import { CardArt } from '../ui/CardArt';
import type { AppState, ComparePick } from '../lib/appState';
import type { BestOrder, GenericView } from '../engine/compare';
import type { AttributionReport, AttributionRow } from '../engine/attribution';
import { leaderName, memberName } from '../ui/members';

const SIDE = ['A', 'B'] as const;

/** One evaluated side: the generic view plus the chart view when a song is set. */
interface Side {
  pick: ComparePick;
  generic: GenericView;
  loo: number[];
  chart: BestOrder | null;
  /** The same team evaluated in its best standing order, for the song report. */
  chartView: GenericView | null;
  chartLoo: number[] | null;
}

function pct(value: number, of: number): string {
  if (!of) return '—';
  const share = (value / of) * 100;
  return `${share >= 0 ? '+' : ''}${share.toFixed(2)}%`;
}

/** Higher is better for every row on this page, so one direction suffices. */
function DiffRow({ label, a, b, format, hint }: {
  label: string; a: number; b: number;
  format: (value: number) => string; hint?: string;
}) {
  const gap = a - b;
  const lead = gap > 0 ? 'a' : gap < 0 ? 'b' : '';
  return (
    <tr>
      <th scope="row" title={hint}>{label}</th>
      <td className={lead === 'a' ? 'is-lead' : ''}>{format(a)}</td>
      <td className={lead === 'b' ? 'is-lead' : ''}>{format(b)}</td>
      <td className="cmp-gap">
        {gap === 0 ? '持平' : (
          <>
            <b>{gap > 0 ? 'A' : 'B'}</b> 多 {format(Math.abs(gap))}
            <span className="cmp-pct">{pct(Math.abs(gap), Math.min(a, b))}</span>
          </>
        )}
      </td>
    </tr>
  );
}

/**
 * One decomposition, read top to bottom.
 *
 * The bar is centred: to the right means A gained there, to the left means B
 * did. Bar length is relative to the largest row, so the shape says which one
 * or two things decided the match.
 */
function AttributionPanel({ title, report, note }: {
  title: string; report: AttributionReport; note?: string;
}) {
  const widest = Math.max(1e-9, ...report.rows.map((row) => Math.abs(row.percent)));
  const value = (row: AttributionRow, side: 'a' | 'b') => {
    const raw = side === 'a' ? row.a : row.b;
    if (row.unit === 'points') return Math.round(raw).toLocaleString();
    if (row.unit === 'percent') return `${raw.toFixed(1)}%`;
    return raw.toFixed(1);
  };
  return (
    <section className="attrib">
      <h3>{title}</h3>
      <p className="attrib-total">
        {report.gap === 0 ? '兩隊相同' : (
          <>
            <b>{report.gap > 0 ? 'A' : 'B'}</b> 高{' '}
            <b className="attrib-gap">{Math.abs(report.gap).toFixed(2)}%</b>
            {'　'}（{report.aTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            {' vs '}{report.bTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}）
          </>
        )}
      </p>
      <ul className="attrib-rows">
        {report.rows.map((row) => (
          <li key={row.label}>
            <span className="attrib-label">{row.label}</span>
            <span className="attrib-bar" aria-hidden="true">
              <i className={row.percent >= 0 ? 'is-a' : 'is-b'}
                 style={{ width: `${(Math.abs(row.percent) / widest) * 50}%` }} />
            </span>
            <b className={row.percent >= 0 ? 'is-a' : 'is-b'}>
              {row.percent >= 0 ? '+' : '−'}{Math.abs(row.percent).toFixed(2)}%
            </b>
            <span className="attrib-values">{value(row, 'a')} / {value(row, 'b')}</span>
          </li>
        ))}
      </ul>
      {note && <p className="metric-note">{note}</p>}
    </section>
  );
}

const int = (value: number) => Math.round(value).toLocaleString();
/**
 * Percentage points, which is what every non-power figure on this page is:
 * Score Support, SAR and the Active effect all reach the score through a
 * `/ 100`, so the unit belongs on the number rather than in the reader's head.
 * Distinct from `share`, which renders a 0..1 ratio as a percentage.
 */
const points = (value: number) => `${value.toFixed(1)}%`;
const share = (value: number) => `${(value * 100).toFixed(1)}%`;

export function ComparePage({ state }: { state: AppState }) {
  const {
    bundle, images, inventory, charts, chartBlob, chartsLoading, loadCharts,
    compare, setCompareSlot, songKey, setSongKey,
  } = state;
  const [open, setOpen] = useState<number | null>(null);

  const chart = useMemo(() => {
    if (!charts || !chartBlob || !songKey) return null;
    const meta = charts.charts.find((row) => row.key === songKey);
    const located = charts.index[songKey];
    if (!meta || !located) return null;
    const [offset, count] = located;
    return { meta, prepared: prepare(meta, materialize(chartBlob, offset, count)) };
  }, [charts, chartBlob, songKey]);

  const sides = useMemo<(Side | null)[]>(() => compare.map((pick) => {
    if (!pick) return null;
    const facts = cardFacts(pick.members,
      pick.members.map((card) => inventory.get(card.id)?.bloom ?? card.maxBloom));
    const leaderBloom = Math.min(
      inventory.get(pick.leader.id.replace(/^outfit:/, ''))?.bloom ?? pick.leader.maxBloom,
      pick.leader.maxBloom,
    );
    const outfits = outfitTable([pick.leader], [leaderBloom]);
    const payload = outfits.payloads[outfits.signatureOf[0]];
    const indices = [0, 1, 2, 3, 4];
    const best = chart ? bestOrder(facts, indices, payload, chart.prepared) : null;
    return {
      pick,
      generic: genericView(facts, indices, payload),
      loo: leaveOneOutGeneric(facts, indices, payload),
      chart: best,
      chartView: best ? genericView(facts, best.order, payload) : null,
      chartLoo: best && chart
        ? leaveOneOutChart(facts, indices, payload, chart.prepared, best.score) : null,
    };
  }), [compare, inventory, chart]);

  const [a, b] = sides;

  const genericAttribution = useMemo(
    () => (a && b ? attributeGeneric(a.generic, b.generic) : null), [a, b]);
  const chartAttribution = useMemo(() => {
    if (!a?.chart || !b?.chart || !a.chartView || !b.chartView || !chart) return null;
    return attributeChart(
      { view: a.chartView, detail: a.chart.detail, score: a.chart.score },
      { view: b.chartView, detail: b.chart.detail, score: b.chart.score },
    );
  }, [a, b, chart]);
  const swap = useMemo(() => {
    if (!a || !b) return null;
    const names = new Map<string, string>();
    for (const side of [a, b]) {
      for (const card of side.pick.members) names.set(card.id, memberName(card));
      names.set(side.pick.leader.id, leaderName(side.pick.leader));
    }
    return singleDifference(
      a.pick.members.map((card) => card.id), b.pick.members.map((card) => card.id),
      a.pick.leader.id, b.pick.leader.id, (id) => names.get(id) ?? id,
    );
  }, [a, b]);

  if (!bundle) return null;
  const both = a && b;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>隊伍比較</h2>
          <p className="page-sub">
            A / B 並排，每一列都標出哪一隊較高，兩邊的原始數值和差距都會留著。所有數字都跟排行榜用同一套算法。
          </p>
        </div>
      </div>

      <div className="cmp-slots">
        {SIDE.map((name, slot) => {
          const side = sides[slot];
          return (
            <section key={name} className={`cmp-slot${side ? '' : ' is-empty'}`}>
              <header>
                <span className="cmp-tag">{name}</span>
                {side
                  ? <><b>{side.pick.source}</b><button className="ghost" onClick={() => setCompareSlot(slot, null)}>清除</button></>
                  : <span className="cmp-hint">到「隊伍最佳化」或「自選隊伍」按「比較」加入</span>}
              </header>
              {side && (
                <ol className="cmp-team">
                  <li className="is-leader">
                    <span className="cmp-role">隊長服裝</span>
                    <span className="cmp-name">{leaderName(side.pick.leader)}</span>
                  </li>
                  {side.pick.members.map((card) => {
                    const style = attributeStyle(card.type);
                    return (
                      <li key={card.id}
                          style={{ ['--accent' as string]: style.accent, ['--accent-line' as string]: style.line }}>
                        <CardArt images={images} cardId={card.id} width={192} height={108}
                                 noArtClassName="cmp-noart" noArtLabel={style.label} />
                        <span className="cmp-name">{memberName(card)}</span>
                        <span className="cmp-title">{card.title || '—'}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          );
        })}
      </div>

      {!both && <p className="hint">兩邊都選好之後，下面會出現逐項比較。</p>}

      {both && (
        <>
          {swap && (
            <p className="cmp-swap">
              兩隊只差{swap.kind === 'member' ? '一名成員' : '隊長服裝'}：
              <b>{swap.fromName}</b> → <b>{swap.toName}</b>。
              綜合推薦指數{' '}
              <b>{int(b.generic.index - a.generic.index)}</b>
              （{pct(b.generic.index - a.generic.index, a.generic.index)}）
              {chart && b.chart && a.chart && (
                <>，指定歌曲預估分{' '}
                  <b>{int(b.chart.score - a.chart.score)}</b>
                  （{pct(b.chart.score - a.chart.score, a.chart.score)}）
                </>
              )}
              。兩隊都是完整的五人隊，這是直接相減的差額，不用任何假設。
            </p>
          )}

          <div className="cmp-scroll">
          <table className="cmp-table">
            <colgroup>
              <col />
              <col className="cmp-col-num" /><col className="cmp-col-num" />
              <col className="cmp-col-gap" />
            </colgroup>
            <thead>
              <tr><th scope="col">項目</th><th scope="col">A</th><th scope="col">B</th><th scope="col">差距</th></tr>
            </thead>
            <tbody>
              <DiffRow label="基礎能力" a={a.generic.basePower} b={b.generic.basePower} format={int} />
              <DiffRow label="被動技能能力加成" a={a.generic.passiveGain} b={b.generic.passiveGain} format={int} />
              <DiffRow label="隊長服裝能力加成" a={a.generic.outfitGain} b={b.generic.outfitGain} format={int} />
              <DiffRow label="最終總合力" a={a.generic.totalPower} b={b.generic.totalPower} format={int} />
              <DiffRow label="被動技能分數支援" a={a.generic.passiveSupport} b={b.generic.passiveSupport} format={points} />
              <DiffRow label="特殊技能分數支援" a={a.generic.specialSupport} b={b.generic.specialSupport} format={points}
                       hint="以 192 秒的參考長度取平均" />
              <DiffRow label="隊長服裝分數支援" a={a.generic.leaderSupport} b={b.generic.leaderSupport} format={points} />
              <DiffRow label="技能發動率加成（SAR）" a={a.generic.sarPoints} b={b.generic.sarPoints} format={points}
                       hint="每個 Rate Up 依自己的持續時間，對 192 秒取平均" />
              <DiffRow label="主動技能平均效果" a={a.generic.activeScoreUp} b={b.generic.activeScoreUp} format={points} />
              <DiffRow label="主動技能時間覆蓋" a={a.generic.activeTimeCoverage} b={b.generic.activeTimeCoverage}
                       format={share} hint="至少一個主動技能生效的時間比例" />
              <DiffRow label="綜合推薦指數" a={a.generic.index} b={b.generic.index} format={int} />
              {chart && a.chart && b.chart && (
                <>
                  <DiffRow label="指定歌曲預估分" a={a.chart.score} b={b.chart.score} format={int}
                           hint="Perfect 全連假設，兩邊各自用自己的最佳站位" />
                  <DiffRow label="主動技能實際貢獻" a={a.chart.detail.activeBonus} b={b.chart.detail.activeBonus} format={points} />
                </>
              )}
            </tbody>
          </table>
          </div>

          {genericAttribution && (
            <AttributionPanel
              title="差異歸因 · 綜合推薦指數"
              report={genericAttribution}
              note={'以下是「歸因貢獻」，不是遊戲給的數字。指數是相乘出來的，百分比本來不能直接相加，'
                + '所以這裡用對數的方式拆開，拆出來的各項加起來剛好等於上面的總差距。'
                + '分數支援本身不會加分，只會放大有發動的主動技能，所以兩者相乘的那部分算在分數支援上。'}
            />
          )}

          <section className="cmp-songbar">
            {charts ? (
              <label>
                <span>指定歌曲</span>
                <select value={songKey} onChange={(event) => setSongKey(event.target.value)}>
                  <option value="">不指定（只比較綜合推薦指數）</option>
                  {charts.charts.map((row) => (
                    <option key={row.key} value={row.key}>
                      {row.title} · {row.difficulty} Lv.{row.difficultyLevel}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <button className="ghost" onClick={loadCharts} disabled={chartsLoading}>
                {chartsLoading ? '正在載入譜面資料…' : '載入譜面，一起比較歌曲分數'}
              </button>
            )}
          </section>

          <p className="metric-note cmp-members-note">
            <b>移除影響</b>：少了這張卡，這一隊會掉多少分。剩下四人的加成、條件與站位都會重新計算，所以五個數字加起來不等於總分。
          </p>
          {chartAttribution && chart && (
            <>
              <AttributionPanel
                title={`差異歸因 · ${chart.meta.title}`}
                report={chartAttribution}
                note={'歌曲模式是在每個音符當下套用主動技能、特殊技能、技能發動率加成和分數支援，'
                  + '沒辦法像上面那樣拆開，所以合併成「本曲技能實際貢獻」一項。'
                  + '分數有取整，誤差已經算進上面能力的三項裡（影響通常不到 0.1 個百分點）。'
                  + '下面的覆蓋率只是幫你看這一項發生在哪裡，不算在歸因裡，也不要跟時間軸上的 ↑ 箭頭混在一起看'
                  + '——那個箭頭講的是蓋到的音符值不值錢，跟這裡的貢獻百分比是兩回事。'}
              />
              <div className="cmp-scroll">
                <table className="cmp-table">
                  <colgroup>
                    <col />
                    <col className="cmp-col-num" /><col className="cmp-col-num" />
                    <col className="cmp-col-gap" />
                  </colgroup>
                  <thead>
                    <tr>
                      {/* Five members' windows overlap, so these sum past 100%. */}
                      <th scope="col">本曲覆蓋（五人合計，會互相重疊，所以可能超過 100%）</th>
                      <th scope="col">A</th><th scope="col">B</th><th scope="col">差距</th>
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      ['主動技能時間覆蓋', 'activeTimeCoverage'],
                      ['主動技能音符覆蓋', 'activeNoteCoverage'],
                      ['主動技能分數覆蓋', 'activeScoreCoverage'],
                      ['特殊技能音符覆蓋', 'specialNoteCoverage'],
                      ['特殊技能分數覆蓋', 'specialScoreCoverage'],
                    ] as const).map(([label, key]) => {
                      const total = (side: Side) => (side.chart?.detail.members ?? [])
                        .reduce((sum, member) => sum + member[key], 0);
                      return (
                        <DiffRow key={key} label={label} a={total(a)} b={total(b)}
                                 format={(value) => `${(value * 100).toFixed(1)}%`} />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="cmp-members">
            {SIDE.map((name, slot) => {
              const side = sides[slot]!;
              return (
                <section key={name} className="cmp-member-panel">
                  <h3><span className="cmp-tag">{name}</span> 各成員移除影響</h3>
                  <ol>
                    {side.pick.members.map((card, index) => {
                      const direct = side.generic.members[index];
                      const chartDetail = side.chart
                        ? side.chart.detail.members?.[side.chart.order.indexOf(index)]
                        : undefined;
                      const key = `${slot}-${index}`;
                      const expanded = open === slot * 10 + index;
                      return (
                        <li key={key}>
                          <div className="cmp-member-head">
                            <span className="cmp-name">{memberName(card)}</span>
                            <span className="cmp-loo">
                              指數 −{int(side.loo[index])}
                              {side.chartLoo && <> · 歌曲 −{int(side.chartLoo[index])}</>}
                            </span>
                            <button type="button" className="team-why" aria-expanded={expanded}
                                    onClick={() => setOpen(expanded ? null : slot * 10 + index)}>
                              {expanded ? '收合' : '分數構成'}
                            </button>
                          </div>
                          {expanded && (
                            <dl className="cmp-direct">
                              <div><dt>三項能力合計</dt><dd>{int(direct.base)}</dd></div>
                              <div><dt>被動技能受益</dt><dd>+{int(direct.passiveGain)}</dd></div>
                              <div><dt>隊長服裝受益</dt><dd>+{int(direct.outfitGain)}</dd></div>
                              <div><dt>被動技能分數支援</dt><dd>+{points(direct.passiveSupport)}</dd></div>
                              <div><dt>特殊技能時間平均</dt><dd>+{points(direct.specialSupport)}</dd></div>
                              <div><dt>技能發動率加成貢獻</dt><dd>+{points(direct.sarPoints)}</dd></div>
                              <div><dt>主動技能效果</dt><dd>+{points(direct.activeScoreUp)}</dd></div>
                              <div><dt>主動技能時間覆蓋</dt><dd>{share(direct.activeTimeCoverage)}</dd></div>
                              {chartDetail && (
                                <>
                                  <div><dt>本曲特殊技能時間</dt><dd>{share(chartDetail.specialTimeCoverage)}</dd></div>
                                  <div><dt>本曲特殊技能音符</dt><dd>{share(chartDetail.specialNoteCoverage)}</dd></div>
                                  <div><dt>本曲特殊技能分數</dt><dd>{share(chartDetail.specialScoreCoverage)}</dd></div>
                                  <div><dt>本曲主動技能時間</dt><dd>{share(chartDetail.activeTimeCoverage)}</dd></div>
                                  <div><dt>本曲主動技能音符</dt><dd>{share(chartDetail.activeNoteCoverage)}</dd></div>
                                  <div><dt>本曲主動技能分數</dt><dd>{share(chartDetail.activeScoreCoverage)}</dd></div>
                                </>
                              )}
                            </dl>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  {side.chart && (
                    <p className="cmp-order">
                      最佳站位：{side.chart.order.map((memberIndex, position) =>
                        `${position + 1}. ${memberName(side.pick.members[memberIndex])}`).join('　')}
                    </p>
                  )}
                </section>
              );
            })}
          </div>

          <p className="metric-note">
            兩隊差距在 1–2% 以內時，不足以判斷誰真的比較強——有幾項加成規則還沒經過遊戲內實測。
          </p>
        </>
      )}
    </>
  );
}
