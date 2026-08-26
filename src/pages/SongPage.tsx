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
import { attributeStyle } from '../ui/theme';
import type { AppState } from '../lib/appState';
import type { CardJson } from '../engine/types';

const DIFFICULTY_ORDER = ['Easy', 'Normal', 'Hard', 'Expert'];

export function SongPage({ state, teamIndex }: { state: AppState; teamIndex: number | null }) {
  const { bundle, images, charts, chartBlob, chartsLoading, loadCharts, run, inventory } = state;
  const [chartKey, setChartKey] = useState('');
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState('Expert');
  const [pickedTeam, setPickedTeam] = useState<number>(teamIndex ?? 0);

  useEffect(() => { loadCharts(); }, [loadCharts]);
  useEffect(() => { if (teamIndex !== null) setPickedTeam(teamIndex); }, [teamIndex]);

  const visibleCharts = useMemo(() => {
    if (!charts) return [];
    const needle = query.trim().toLowerCase();
    return charts.charts
      .filter((chart) => (!difficulty || chart.difficulty === difficulty)
        && (!needle || String(chart.title ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => (a.difficultyLevel ?? 0) - (b.difficultyLevel ?? 0)
        || String(a.title).localeCompare(String(b.title), 'ja'));
  }, [charts, query, difficulty]);

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
              {DIFFICULTY_ORDER.map((value) => (
                <button key={value} className={difficulty === value ? 'is-on' : ''}
                        onClick={() => setDifficulty(value)}>{value}</button>
              ))}
            </div>
            <span className="page-count">{visibleCharts.length} 首</span>
          </div>

          <div className="song-split">
            <ol className="song-list">
              {visibleCharts.map((chart) => (
                <li key={chart.key}>
                  <button className={chart.key === chartKey ? 'is-on' : ''} onClick={() => setChartKey(chart.key)}>
                    <span className="song-title">{chart.title}</span>
                    <span className="song-meta">Lv.{chart.difficultyLevel} · {chart.fullComboNoteCount} notes</span>
                  </button>
                </li>
              ))}
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
