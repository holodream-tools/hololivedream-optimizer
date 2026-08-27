/**
 * 歌曲／順序 — projected Perfect-FC score for a chosen chart, and the standing
 * order that maximises it.
 *
 * Standing order matters because the five Special slots fire at times the chart
 * fixes; which member holds which slot changes what the Specials cover.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { materialize, prepare } from '../engine/chartScore';
import { cardFacts, outfitTable } from '../engine/precompute';
import { bestOrder } from '../engine/compare';
import {
  FUNNEL_DEPTHS, distinctFormations, rankSongResults, scoreCandidates, upliftOverGenericBest,
} from '../engine/songOptimize';
import { SongTimeline } from '../ui/SongTimeline';
import { DIFFICULTIES, attributeStyle, difficultyStyle, duration } from '../ui/theme';
import type { AppState } from '../lib/appState';
import type { CardJson } from '../engine/types';
import type { ChartMeta, PreparedChart } from '../engine/chartScore';
import type { SongRanked, SongScored } from '../engine/songOptimize';

type SongMode = 'team' | 'optimize';

/**
 * Hand the browser a turn between batches.
 *
 * setTimeout would do it in a focused tab, but Chrome clamps timers in a
 * backgrounded one to about once a second: forty batches then take forty
 * seconds of waiting on top of seven seconds of arithmetic. A MessageChannel
 * task is not throttled, so a run keeps its pace when the player switches tabs.
 */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
    channel.port2.postMessage(null);
  });
}

type SongSort = 'id' | 'level' | 'notes' | 'length' | 'title';

/**
 * `id` sorts on the game's own song number. It is NOT a release order: the ids
 * fall into three separate blocks (m0001-0206, m0300-0353, m0524), so comparing
 * across blocks says nothing about which song came first. The label names the
 * number rather than implying a date, and the catalogue carries no dates to do
 * better with.
 */
const SORTS: ReadonlyArray<readonly [SongSort, string]> = [
  ['id', '曲目編號'],
  ['level', '難度'],
  ['notes', '音符數'],
  ['length', '曲長'],
  ['title', '歌名'],
];

export function SongPage({ state, teamIndex }: { state: AppState; teamIndex: number | null }) {
  const {
    bundle, images, charts, chartBlob, chartsLoading, loadCharts, run, inventory,
    owned, unlockedLeaders, stamp, songKey: chartKey, setSongKey: setChartKey,
  } = state;
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState('Expert');
  const [sort, setSort] = useState<SongSort>('level');
  const [pickedTeam, setPickedTeam] = useState<number>(teamIndex ?? 0);
  const [mode, setMode] = useState<SongMode>('team');
  const [depth, setDepth] = useState<number>(FUNNEL_DEPTHS[0].k);
  const [ranked, setRanked] = useState<SongRanked[] | null>(null);
  const [uplift, setUplift] = useState<ReturnType<typeof upliftOverGenericBest>>(null);
  const [pool, setPool] = useState(0);
  /** Which of the ranked teams the timeline is drawing; the winner by default. */
  const [timelineTeam, setTimelineTeam] = useState(0);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  // A run token, not a cancel flag: a shared boolean lets a new run clear the
  // old one's cancellation, and both then keep going and fight over progress.
  const runIdRef = useRef(0);

  useEffect(() => { loadCharts(); }, [loadCharts]);
  useEffect(() => { if (teamIndex !== null) setPickedTeam(teamIndex); }, [teamIndex]);

  const visibleCharts = useMemo(() => {
    if (!charts) return [];
    const needle = query.trim().toLowerCase();
    const rows = charts.charts.filter((chart) =>
      (!difficulty || chart.difficulty === difficulty)
      && (!needle || String(chart.title ?? '').toLowerCase().includes(needle)));
    const byTitle = (a: ChartMeta, b: ChartMeta) =>
      String(a.title).localeCompare(String(b.title), 'ja');
    const compare: Record<SongSort, (a: ChartMeta, b: ChartMeta) => number> = {
      // Newest, hardest and longest first: that is the direction a player wants
      // when they reach for the control at all.
      id: (a, b) => String(b.musicId).localeCompare(String(a.musicId)) || byTitle(a, b),
      level: (a, b) => (b.difficultyLevel ?? 0) - (a.difficultyLevel ?? 0) || byTitle(a, b),
      notes: (a, b) => (b.fullComboNoteCount ?? 0) - (a.fullComboNoteCount ?? 0) || byTitle(a, b),
      length: (a, b) => (b.playingSeconds ?? 0) - (a.playingSeconds ?? 0) || byTitle(a, b),
      title: byTitle,
    };
    return [...rows].sort(compare[sort]);
  }, [charts, query, difficulty, sort]);

  const chartMeta = useMemo(
    () => charts?.charts.find((row) => row.key === chartKey) ?? null,
    [charts, chartKey],
  );

  // One prepared chart for the page: scoring, ranking and the timeline all read
  // the same prefix sums, so a picture cannot drift from the score beside it.
  const chartPrepared = useMemo<PreparedChart | null>(() => {
    const located = chartKey ? charts?.index[chartKey] : undefined;
    if (!chartMeta || !located || !chartBlob) return null;
    const [offset, count] = located;
    return prepare(chartMeta, materialize(chartBlob, offset, count));
  }, [chartMeta, charts, chartBlob, chartKey]);

  const team = run?.rows[pickedTeam];

  const outcome = useMemo(() => {
    if (!team || !chartMeta || !chartPrepared) return null;
    const located = charts?.index[chartKey];
    if (!located) return null;

    const meta = chartMeta;
    const prepared = chartPrepared;
    const count = located[1];
    const facts = cardFacts(team.members, team.members.map((card) => inventory.get(card.id)?.bloom ?? card.maxBloom));
    const leaderBloom = Math.min(
      inventory.get(team.leader.id.replace(/^outfit:/, ''))?.bloom ?? team.leader.maxBloom,
      team.leader.maxBloom,
    );
    const outfits = outfitTable([team.leader], [leaderBloom]);
    const payload = outfits.payloads[outfits.signatureOf[0]];

    // Every standing order is one permutation of the five Special slots; the
    // search lives in the engine so both modes rank orders the same way.
    const best = bestOrder(facts, [0, 1, 2, 3, 4], payload, prepared);
    return { meta, prepared, best, worst: best.worst, detail: best.detail, noteCount: count };
  }, [team, chartMeta, chartPrepared, charts, chartKey, inventory]);

  // A result belongs to one song at one depth; changing either invalidates it.
  useEffect(() => {
    runIdRef.current += 1;
    setBusy(null); setRanked(null); setUplift(null); setTimelineTeam(0);
  }, [chartKey, depth, stamp]);

  const runSongOptimize = useCallback(async () => {
    if (!run || !chartPrepared) return;
    const prepared = chartPrepared;

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setRanked(null);
    setUplift(null);
    // Rebuilt exactly as the sweep built them, so the candidate indices mean the
    // same cards they meant when the ranking was produced.
    const facts = cardFacts(owned, owned.map((card) => inventory.get(card.id)?.bloom ?? card.maxBloom));
    const outfits = outfitTable(unlockedLeaders, unlockedLeaders.map((leader) => {
      const row = inventory.get(leader.id.replace(/^outfit:/, ''));
      return Math.min(row?.bloom ?? leader.maxBloom, leader.maxBloom);
    }));
    const payloadOf = (leaderIndex: number) => outfits.payloads[outfits.signatureOf[leaderIndex]];

    const candidates = distinctFormations(run.candidates).slice(0, depth);
    setPool(candidates.length);
    const scored: SongScored[] = [];
    // Small enough that the page keeps painting, large enough that the yield
    // itself is not the cost: the deep run is 1000 teams x 120 orders.
    const BATCH = 25;
    setBusy({ done: 0, total: candidates.length });
    for (let index = 0; index < candidates.length; index += BATCH) {
      if (runIdRef.current !== runId) return;
      scoreCandidates(facts, candidates, payloadOf, prepared, index, index + BATCH, scored);
      setBusy({ done: Math.min(index + BATCH, candidates.length), total: candidates.length });
      await yieldToBrowser();
    }
    if (runIdRef.current !== runId) return;
    const top = rankSongResults(facts, scored, payloadOf, prepared, 10);
    setRanked(top);
    setUplift(upliftOverGenericBest(top, scored));
    setTimelineTeam(0);
    setBusy(null);
  }, [run, chartPrepared, owned, unlockedLeaders, inventory, depth]);

  if (!bundle) return null;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>歌曲／順序</h2>
          <p className="page-sub">
            以公開譜面計算<b>指定歌曲理論預估分（Perfect 假設）</b>，並找出最佳站位。不含玩家失誤、Board、Connect、Memory 與 Fever。
          </p>
        </div>
      </div>

      {!run && <p className="hint">先到「最佳化」計算一次，才能在這裡挑隊伍。</p>}

      {run && (
        <div className="mode-switch" role="group" aria-label="模式">
          <button className={mode === 'team' ? 'is-on' : ''} onClick={() => setMode('team')}>
            指定隊伍
            <span>算你挑的那一隊</span>
          </button>
          <button className={mode === 'optimize' ? 'is-on' : ''} onClick={() => setMode('optimize')}>
            歌曲最佳化
            <span>為這首歌重新找隊伍</span>
          </button>
        </div>
      )}

      {run && mode === 'team' && (
        <>
          <div className="filters">
            <select value={pickedTeam} onChange={(event) => setPickedTeam(Number(event.target.value))}
                    title="隊伍依綜合推薦指數排名；選單裡的數字是指數，不是歌曲預估分。">
              {run.rows.map((row, index) => (
                <option key={index} value={index}>
                  #{index + 1} · {Math.round(row.value).toLocaleString()} · {row.members.map((card) => card.name).join('、')}
                </option>
              ))}
            </select>
          </div>
          {/* The dropdown carries the optimiser's index, the panel below carries a
              song score. Same page, two different quantities -- say which is which. */}
          <p className="metric-note is-filter-note">
            選單裡的數字是<b>綜合推薦指數</b>（隊伍排名用），不是歌曲預估分。
          </p>
        </>
      )}

      {chartsLoading && <p className="hint">正在載入譜面資料…</p>}

      {charts && run && (
        <>
          <div className="filters">
            <input type="search" value={query} placeholder="搜尋歌名"
                   onChange={(event) => setQuery(event.target.value)} />
            <div className="attr-filter" role="group" aria-label="難度">
              {DIFFICULTIES.map((value) => {
                const style = difficultyStyle(value);
                return (
                  <button key={value} className={difficulty === value ? 'is-on' : ''}
                          style={{ ['--accent' as string]: style.accent, ['--accent-soft' as string]: style.soft, ['--accent-line' as string]: style.line }}
                          onClick={() => setDifficulty(value)}>{value}</button>
                );
              })}
            </div>
            <div className="attr-filter" role="group" aria-label="排序">
              <span className="sort-label">排序</span>
              {SORTS.map(([value, label]) => (
                <button key={value} className={sort === value ? 'is-on' : ''}
                        title={value === 'title' ? '由 A 到 Z' : '由大到小'}
                        onClick={() => setSort(value)}>{label}</button>
              ))}
            </div>
            <span className="page-count">{visibleCharts.length} 首</span>
          </div>

          <div className="song-split">
            <ol className="song-list">
              {visibleCharts.map((chart) => {
                const style = difficultyStyle(chart.difficulty);
                return (
                  <li key={chart.key}>
                    <button className={chart.key === chartKey ? 'is-on' : ''}
                            style={{ ['--accent' as string]: style.accent, ['--accent-soft' as string]: style.soft, ['--accent-line' as string]: style.line }}
                            onClick={() => setChartKey(chart.key)}>
                      <span className="song-level">{chart.difficultyLevel}</span>
                      <span className="song-text">
                        <span className="song-title">{chart.title}</span>
                        <span className="song-meta">
                          {chart.difficulty} · {(chart.fullComboNoteCount ?? 0).toLocaleString()} notes
                          {' · '}{duration(chart.playingSeconds)}
                          {sort === 'id' && <span className="song-id"> · {chart.musicId}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="song-detail">
              {!chartKey && <p className="empty">從左邊選一首歌。</p>}

              {mode === 'optimize' && chartMeta && (
                <>
                  <header className="song-head">
                    <h3>{chartMeta.title}</h3>
                    <p className="song-sub">
                      {chartMeta.difficulty} Lv.{chartMeta.difficultyLevel} ·
                      {' '}{(chartMeta.fullComboNoteCount ?? 0).toLocaleString()} notes ·
                      {' '}{Math.round(chartMeta.playingSeconds ?? 0)} 秒
                    </p>
                  </header>

                  <div className="funnel">
                    <div className="funnel-depths" role="group" aria-label="候選深度">
                      {FUNNEL_DEPTHS.map((option) => (
                        <button key={option.k} className={depth === option.k ? 'is-on' : ''}
                                disabled={!!busy}
                                onClick={() => setDepth(option.k)}>
                          {option.label}
                          <span>{option.note}</span>
                        </button>
                      ))}
                    </div>
                    {busy
                      ? (
                        <div className="runbar-progress">
                          <div className="bar"><i style={{ width: `${(busy.done / busy.total) * 100}%` }} /></div>
                          <span className="pct">{busy.done} / {busy.total}</span>
                          <button className="ghost"
                                  onClick={() => { runIdRef.current += 1; setBusy(null); }}>取消</button>
                        </div>
                      )
                      : <button className="primary" onClick={runSongOptimize}>歌曲精算</button>}
                  </div>

                  {run.stamp !== stamp && (
                    <p className="stale">庫存已變更，請重新跑一次「最佳化」再做歌曲精算。</p>
                  )}

                  {ranked && ranked.length > 0 && (
                    <>
                      <div className="song-score">
                        <p className="breakdown-label"
                           title="依實際歌曲譜面、Combo、Special、Active、SAR 等時間點計算。">
                          這首歌的最佳隊伍 · 預估分（Perfect 假設）
                        </p>
                        <b>{ranked[0].songScore.toLocaleString()}</b>
                        <p className="song-delta">
                          該隊伍的通用排名 #{ranked[0].genericRank}
                          {uplift && (
                            <>
                              {' · '}比通用最佳隊在這首歌高{' '}
                              <b className="uplift">{(uplift.uplift * 100).toFixed(2)}%</b>
                              （通用 #1 在這首歌排第 {uplift.genericBestSongRank}，
                              {uplift.genericBestScore.toLocaleString()} 分）
                            </>
                          )}
                        </p>
                      </div>

                      <ol className="order-line">
                        {/* `order` permutes the candidate's own card indices, so
                            each entry already points into `owned`. */}
                        {ranked[0].order.map((cardIndex, slot) => {
                          const card = owned[cardIndex];
                          if (!card) return null;
                          const style = attributeStyle(card.type);
                          return (
                            <li key={slot} style={{ ['--accent' as string]: style.accent, ['--accent-line' as string]: style.line }}>
                              <span className="order-slot">Special {slot + 1}</span>
                              {images?.url(card.id)
                                ? <img src={images.url(card.id)} alt="" width={192} height={108} />
                                : <span className="slot-noart">{style.label}</span>}
                              <span className="order-name">{card.name}</span>
                            </li>
                          );
                        })}
                      </ol>
                      <p className="song-source">
                        隊長服裝：{unlockedLeaders[ranked[0].leaderIndex]?.name ?? '—'}
                      </p>

                      <table className="cmp-table song-rank-table">
                        <thead>
                          <tr>
                            <th scope="col">歌曲</th><th scope="col">預估分</th>
                            <th scope="col">通用排名</th><th scope="col">最佳 Skill Order</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ranked.map((row) => (
                            <tr key={row.songRank}
                                className={row.songRank - 1 === timelineTeam ? 'is-picked' : ''}
                                onClick={() => setTimelineTeam(row.songRank - 1)}
                                title="看這一隊的時間軸">
                              <th scope="row">#{row.songRank}</th>
                              <td>{row.songScore.toLocaleString()}</td>
                              <td>#{row.genericRank}</td>
                              <td className="order-cell">
                                {row.order.map((cardIndex) => owned[cardIndex]?.name ?? '?').join(' → ')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {ranked[timelineTeam] && chartPrepared && (
                        <section className="timeline-block">
                          <h4>
                            Timeline 分析
                            <span>
                              第 {ranked[timelineTeam].songRank} 名 ·
                              {' '}{ranked[timelineTeam].songScore.toLocaleString()} 分 ·
                              {' '}通用 #{ranked[timelineTeam].genericRank}
                            </span>
                          </h4>
                          <p className="timeline-order">
                            最佳 Skill Order：
                            {ranked[timelineTeam].order
                              .map((cardIndex, slot) => `${slot + 1}. ${owned[cardIndex]?.name ?? '?'}`)
                              .join('　')}
                          </p>
                          <SongTimeline
                            prepared={chartPrepared}
                            detail={ranked[timelineTeam].detail}
                            members={ranked[timelineTeam].order.map((cardIndex) => owned[cardIndex])}
                          />
                        </section>
                      )}

                      <p className="metric-note">
                        這是從通用排名前 {pool.toLocaleString()} 組候選中精算出來的最佳解，不是全域最佳。
                        實測六首歌，冠軍都落在通用前 50；但完整的歌曲前十要到前 1000 組才收齊，所以想看完整排名請切「完整 Top 10」。
                      </p>
                    </>
                  )}

                  {!ranked && !busy && (
                    <p className="empty">按「歌曲精算」開始。</p>
                  )}
                </>
              )}

              {mode === 'team' && outcome && (
                <>
                  <header className="song-head">
                    <h3>{outcome.meta.title}</h3>
                    <p className="song-sub">
                      {outcome.meta.difficulty} Lv.{outcome.meta.difficultyLevel} ·
                      {' '}{outcome.noteCount.toLocaleString()} notes ·
                      {' '}{Math.round(outcome.meta.playingSeconds ?? 0)} 秒
                    </p>
                  </header>

                  <div className="song-score">
                    <p className="breakdown-label"
                       title="依實際歌曲譜面、Combo、Special、Active、SAR 等時間點計算。">
                      指定歌曲理論預估分（Perfect 假設）
                    </p>
                    <b>{outcome.best.score.toLocaleString()}</b>
                    <p className="song-delta">
                      最佳站位 · 最差站位 {outcome.worst.toLocaleString()}
                      （相差 {(outcome.best.score - outcome.worst).toLocaleString()}）
                    </p>
                  </div>

                  <ol className="order-line">
                    {outcome.best.order.map((memberIndex, slot) => {
                      const card: CardJson = team!.members[memberIndex];
                      const style = attributeStyle(card.type);
                      return (
                        <li key={slot} style={{ ['--accent' as string]: style.accent, ['--accent-line' as string]: style.line }}>
                          <span className="order-slot">Special {slot + 1}</span>
                          {images?.url(card.id)
                            ? <img src={images.url(card.id)} alt="" width={192} height={108} />
                            : <span className="slot-noart">{style.label}</span>}
                          <span className="order-name">{card.name}</span>
                          <span className="order-time">{outcome.prepared.specialTimes[slot].toFixed(1)}s</span>
                        </li>
                      );
                    })}
                  </ol>

                  <dl className="breakdown-parts">
                    <div><dt>加成後總合力</dt><dd>{outcome.detail.totalPower.toLocaleString()}</dd></div>
                    <div><dt>PERFECT 基礎分</dt><dd>{outcome.detail.perfectNoteScore.toLocaleString()}</dd></div>
                    <div><dt>譜面除數</dt><dd>{outcome.detail.scoreRatio.toFixed(2)}</dd></div>
                    <div><dt>Active 實際貢獻</dt><dd>+{outcome.detail.activeBonus.toFixed(1)}%</dd></div>
                  </dl>
                  <p className="song-source">除數來源：{outcome.detail.ratioSource}</p>
                  <p className="metric-note">
                    這個數字依實際歌曲譜面、Combo、Special、Active、SAR 等時間點逐音符計算，與「隊伍最佳化」的綜合推薦指數量綱不同，兩者不能互相比較。
                  </p>

                  {/* The same component on the same detail object the score above
                      was read from: this mode already ran all 120 orders through
                      bestOrder, so the windows and coverages were sitting unused. */}
                  <section className="timeline-block">
                    <h4>
                      Timeline 分析
                      <span>{outcome.best.score.toLocaleString()} 分 · 最佳站位</span>
                    </h4>
                    <SongTimeline
                      prepared={outcome.prepared}
                      detail={outcome.detail}
                      members={outcome.best.order.map((memberIndex) => team!.members[memberIndex])}
                    />
                  </section>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
