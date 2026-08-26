/**
 * 歌曲／順序 — projected Perfect-FC score for a chosen chart, and the standing
 * order that maximises it.
 *
 * Standing order matters because the five Special slots fire at times the chart
 * fixes; which member holds which slot changes what the Specials cover.
 */
import { useEffect, useMemo, useState } from 'react';
import { materialize, prepare, projectedScore } from '../engine/chartScore';
import { cardFacts, outfitTable } from '../engine/precompute';
import { makeMemberState, memberPart } from '../engine/overallScore';
import { DIFFICULTIES, attributeStyle, difficultyStyle, duration } from '../ui/theme';
import type { AppState } from '../lib/appState';
import type { CardJson } from '../engine/types';
import type { ChartMeta } from '../engine/chartScore';

type SongSort = 'newest' | 'level' | 'length' | 'title';

/**
 * `newest` sorts on musicId, which increases with each addition. That is an
 * ordering, not a release date -- the catalogue carries no dates -- so the
 * control says 新→舊 rather than claiming a year.
 */
const SORTS: ReadonlyArray<readonly [SongSort, string]> = [
  ['newest', '新→舊'],
  ['level', '難度'],
  ['length', '曲長'],
  ['title', '歌名'],
];

export function SongPage({ state, teamIndex }: { state: AppState; teamIndex: number | null }) {
  const { bundle, images, charts, chartBlob, chartsLoading, loadCharts, run, inventory } = state;
  const [chartKey, setChartKey] = useState('');
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState('Expert');
  const [sort, setSort] = useState<SongSort>('newest');
  const [pickedTeam, setPickedTeam] = useState<number>(teamIndex ?? 0);

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
      newest: (a, b) => String(b.musicId).localeCompare(String(a.musicId)) || byTitle(a, b),
      level: (a, b) => (b.difficultyLevel ?? 0) - (a.difficultyLevel ?? 0) || byTitle(a, b),
      length: (a, b) => (b.playingSeconds ?? 0) - (a.playingSeconds ?? 0) || byTitle(a, b),
      title: byTitle,
    };
    return [...rows].sort(compare[sort]);
  }, [charts, query, difficulty, sort]);

  const team = run?.rows[pickedTeam];

  const outcome = useMemo(() => {
    if (!team || !charts || !chartBlob || !chartKey) return null;
    const meta = charts.charts.find((chart) => chart.key === chartKey);
    const located = charts.index[chartKey];
    if (!meta || !located) return null;

    const [offset, count] = located;
    const prepared = prepare(meta, materialize(chartBlob, offset, count));
    const facts = cardFacts(team.members, team.members.map((card) => inventory.get(card.id)?.bloom ?? card.maxBloom));
    const leaderBloom = Math.min(
      inventory.get(team.leader.id.replace(/^outfit:/, ''))?.bloom ?? team.leader.maxBloom,
      team.leader.maxBloom,
    );
    const outfits = outfitTable([team.leader], [leaderBloom]);
    const payload = outfits.payloads[outfits.signatureOf[0]];

    // Every standing order is one permutation of the five Special slots.
    const orders: number[][] = [];
    const walk = (remaining: number[], acc: number[]) => {
      if (!remaining.length) { orders.push(acc); return; }
      remaining.forEach((value, index) =>
        walk([...remaining.slice(0, index), ...remaining.slice(index + 1)], [...acc, value]));
    };
    walk([0, 1, 2, 3, 4], []);

    const memberState = makeMemberState();
    let best: { order: number[]; score: number } | null = null;
    let worst = Infinity;
    for (const order of orders) {
      memberPart(facts, order, memberState);
      const score = projectedScore(facts, order, payload, prepared, memberState).projectedScore;
      if (!best || score > best.score) best = { order, score };
      if (score < worst) worst = score;
    }
    memberPart(facts, best!.order, memberState);
    const detail = projectedScore(facts, best!.order, payload, prepared, memberState);
    return { meta, prepared, best: best!, worst, detail, noteCount: count };
  }, [team, charts, chartBlob, chartKey, inventory]);

  if (!bundle) return null;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>歌曲／順序</h2>
          <p className="page-sub">
            以公開譜面計算 Perfect-FC 預估分，並找出最佳站位。不含玩家失誤、Board、Connect、Memory 與 Fever。
          </p>
        </div>
      </div>

      {!run && <p className="hint">先到「最佳化」計算一次，才能在這裡挑隊伍。</p>}

      {run && (
        <div className="filters">
          <select value={pickedTeam} onChange={(event) => setPickedTeam(Number(event.target.value))}>
            {run.rows.map((row, index) => (
              <option key={index} value={index}>
                #{index + 1} · {Math.round(row.value).toLocaleString()} · {row.members.map((card) => card.name).join('、')}
              </option>
            ))}
          </select>
        </div>
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
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="song-detail">
              {!chartKey && <p className="empty">從左邊選一首歌。</p>}
              {outcome && (
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
                    <p className="breakdown-label">最佳站位預估分</p>
                    <b>{outcome.best.score.toLocaleString()}</b>
                    <p className="song-delta">
                      最差站位 {outcome.worst.toLocaleString()}
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
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
