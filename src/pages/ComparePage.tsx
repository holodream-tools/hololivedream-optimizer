/**
 * 隊伍比較 — two teams side by side, every figure from the ranking engine.
 *
 * The page never computes a number of its own: it calls the same functions the
 * sweep and the song page call, so a row here can never disagree with the
 * leaderboard the teams came from.
 */
import { useMemo, useState } from 'react';
import {
  LEAVE_ONE_OUT_NOTE, bestOrder, genericView, leaveOneOutChart, leaveOneOutGeneric,
  singleDifference,
} from '../engine/compare';
import { materialize, prepare } from '../engine/chartScore';
import { cardFacts, outfitTable } from '../engine/precompute';
import { attributeStyle } from '../ui/theme';
import type { AppState, ComparePick } from '../lib/appState';
import type { BestOrder, GenericView } from '../engine/compare';

const SIDE = ['A', 'B'] as const;

/** One evaluated side: the generic view plus the chart view when a song is set. */
interface Side {
  pick: ComparePick;
  generic: GenericView;
  loo: number[];
  chart: BestOrder | null;
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

const int = (value: number) => Math.round(value).toLocaleString();
const one = (value: number) => value.toFixed(1);
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
      chartLoo: best && chart
        ? leaveOneOutChart(facts, indices, payload, chart.prepared, best.score) : null,
    };
  }), [compare, inventory, chart]);

  const [a, b] = sides;
  const swap = useMemo(() => {
    if (!a || !b) return null;
    const names = new Map<string, string>();
    for (const side of [a, b]) {
      for (const card of side.pick.members) names.set(card.id, card.name);
      names.set(side.pick.leader.id, side.pick.leader.name);
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
            A / B 並排，每一列都標出哪一隊較高，但兩邊的原始數值都保留。所有數字都由排行榜同一套計算函式產生。
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
                    <span className="cmp-name">{side.pick.leader.name}</span>
                  </li>
                  {side.pick.members.map((card) => {
                    const style = attributeStyle(card.type);
                    const url = images?.url(card.id);
                    return (
                      <li key={card.id}
                          style={{ ['--accent' as string]: style.accent, ['--accent-line' as string]: style.line }}>
                        {url
                          ? <img src={url} alt="" loading="lazy" width={192} height={108} />
                          : <span className="cmp-noart">{style.label}</span>}
                        <span className="cmp-name">{card.name}</span>
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
              。這是兩支合法隊伍的直接差額，不需要任何反事實假設。
            </p>
          )}

          <div className="cmp-scroll">
          <table className="cmp-table">
            <thead>
              <tr><th scope="col">項目</th><th scope="col">A</th><th scope="col">B</th><th scope="col">差距</th></tr>
            </thead>
            <tbody>
              <DiffRow label="基礎總能力" a={a.generic.basePower} b={b.generic.basePower} format={int} />
              <DiffRow label="Passive 能力加成" a={a.generic.passiveGain} b={b.generic.passiveGain} format={int} />
              <DiffRow label="Outfit 能力加成" a={a.generic.outfitGain} b={b.generic.outfitGain} format={int} />
              <DiffRow label="最終總合力" a={a.generic.totalPower} b={b.generic.totalPower} format={int} />
              <DiffRow label="Passive Score Support" a={a.generic.passiveSupport} b={b.generic.passiveSupport} format={one} />
              <DiffRow label="Special Score Support" a={a.generic.specialSupport} b={b.generic.specialSupport} format={one}
                       hint="以 192 秒參考長度做時間平均" />
              <DiffRow label="Outfit Score Support" a={a.generic.leaderSupport} b={b.generic.leaderSupport} format={one} />
              <DiffRow label="SAR（技能發動率）" a={a.generic.sarPoints} b={b.generic.sarPoints} format={one}
                       hint="各 Rate Up 以自身持續時間對 192 秒加權平均" />
              <DiffRow label="Active 平均效果" a={a.generic.activeScoreUp} b={b.generic.activeScoreUp} format={one} />
              <DiffRow label="Active 覆蓋率" a={a.generic.activeCoverage} b={b.generic.activeCoverage} format={share}
                       hint="至少一個 Active 生效的機率" />
              <DiffRow label="綜合推薦指數" a={a.generic.index} b={b.generic.index} format={int} />
              {chart && a.chart && b.chart && (
                <>
                  <DiffRow label="指定歌曲預估分" a={a.chart.score} b={b.chart.score} format={int}
                           hint="Perfect 假設，各自的最佳站位" />
                  <DiffRow label="Active 實際貢獻" a={a.chart.detail.activeBonus} b={b.chart.detail.activeBonus} format={one} />
                </>
              )}
            </tbody>
          </table>
          </div>

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
                {chartsLoading ? '正在載入譜面資料…' : '載入譜面，加上歌曲分數比較'}
              </button>
            )}
          </section>

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
                            <span className="cmp-name">{card.name}</span>
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
                              <div><dt>三圍</dt><dd>{int(direct.base)}</dd></div>
                              <div><dt>Passive 受益</dt><dd>+{int(direct.passiveGain)}</dd></div>
                              <div><dt>Outfit 受益</dt><dd>+{int(direct.outfitGain)}</dd></div>
                              <div><dt>Passive Score Support</dt><dd>+{one(direct.passiveSupport)}</dd></div>
                              <div><dt>Special 時間平均</dt><dd>+{one(direct.specialSupport)}</dd></div>
                              <div><dt>SAR 貢獻</dt><dd>+{one(direct.sarPoints)}</dd></div>
                              <div><dt>Active 效果</dt><dd>+{one(direct.activeScoreUp)}%</dd></div>
                              <div><dt>Active 覆蓋</dt><dd>{share(direct.activeCoverage)}</dd></div>
                              {chartDetail && (
                                <>
                                  <div><dt>本曲 Special 覆蓋</dt><dd>{share(chartDetail.specialCoverage)}</dd></div>
                                  <div><dt>本曲 Active 覆蓋</dt><dd>{share(chartDetail.activeCoverage)}</dd></div>
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
                        `${position + 1}. ${side.pick.members[memberIndex].name}`).join('　')}
                    </p>
                  )}
                </section>
              );
            })}
          </div>

          <p className="metric-note">{LEAVE_ONE_OUT_NOTE}</p>
          <p className="metric-note">
            兩隊差距在數個百分點以內時要小心：Passive 之間相加、以及「隊伍中有 N 名某屬性」這類效果選誰受益的規則，
            目前尚未以遊戲實測確認，差距可能落在模型誤差內而不是真的強弱。
          </p>
        </>
      )}
    </>
  );
}
