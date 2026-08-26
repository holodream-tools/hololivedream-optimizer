/** 最佳化 — sweep every legal five-member team against every unlocked Outfit. */
import { useCallback, useRef, useState } from 'react';
import { binomial } from '../engine/combinations';
import { cardFacts, outfitTable } from '../engine/precompute';
import { applyDiversity, type DiversityOptions } from '../engine/diversity';
import { leaderPowerAndSupport, makeMemberState, memberPart } from '../engine/overallScore';
import { optimize } from '../lib/optimizerClient';
import { PinPicker } from '../ui/PinPicker';
import { TeamRow } from '../ui/TeamRow';
import type { AppState } from '../lib/appState';
import type { CardJson } from '../engine/types';

export function OptimizerPage({ state, onOpenSong }: { state: AppState; onOpenSong: (index: number) => void }) {
  const { bundle, images, owned, unlockedLeaders, inventory, stamp, run } = state;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string[]>([]);
  const [diversity, setDiversity] = useState<DiversityOptions>({
    oneLeaderPerTeam: true, minDistinctMembers: 0,
  });
  const [shownCount, setShownCount] = useState(20);

  // The sweep always keeps this many internally. Measured across 50/100/200/400
  // the cost is indistinguishable, so the headroom is free -- and it means the
  // display count and the diversity filters are pure slicing, never a recompute.
  const KEPT = 200;
  const abortRef = useRef<AbortController | null>(null);
  const imageUrl = (card: CardJson) => images?.url(card.id);

  // Four is the useful maximum: pinning all five leaves nothing to search for.
  const MAX_PINNED = 4;
  const pinnedIndices = pinned
    .map((id) => owned.findIndex((card) => card.id === id))
    .filter((index) => index >= 0);

  const start = useCallback(async () => {
    if (!bundle || owned.length < 5 || !unlockedLeaders.length) return;
    setError(null);
    state.setRun(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const facts = cardFacts(owned, owned.map((card) => inventory.get(card.id)!.bloom));
    const outfits = outfitTable(unlockedLeaders, unlockedLeaders.map((leader) => {
      const row = inventory.get(leader.id.replace(/^outfit:/, ''));
      return Math.min(row?.bloom ?? leader.maxBloom, leader.maxBloom);
    }));
    setProgress({ done: 0, total: binomial(owned.length, 5) });
    try {
      const raw = await optimize({
        facts, outfits, limit: KEPT, signal: controller.signal,
        required: pinnedIndices,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      // Detail is rebuilt only for the rows that survived, so the hot loop stays
      // free of anything the ranking does not need.
      const detailState = makeMemberState();
      state.setRun({
        rows: raw.rows.map((row) => {
          memberPart(facts, row.members, detailState);
          const payload = outfits.payloads[outfits.signatureOf[row.leaderIndex]];
          const [totalPower, leaderSupport] = leaderPowerAndSupport(payload, detailState);
          return {
            value: row.value,
            memberIndices: row.members,
            members: row.members.map((index) => owned[index]),
            leader: unlockedLeaders[row.leaderIndex],
            breakdown: {
              basePower: row.members.reduce((sum, index) => sum + facts[index].total, 0),
              totalPower,
              activeScoreUp: detailState.activeScoreUp,
              passiveSupport: detailState.staticSupport,
              leaderSupport,
              specialSupport: detailState.specialSupport,
            },
          };
        }),
        evaluations: raw.evaluations, seconds: raw.seconds, workers: raw.workers,
        scored: raw.scored, pinned: pinned.slice(),
        ownedCount: owned.length, leaderCount: unlockedLeaders.length, stamp,
      });
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError') setError(String(cause));
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  }, [bundle, owned, unlockedLeaders, inventory, stamp, state, pinned, pinnedIndices]);

  // Ranks come from the unfiltered list, so hiding a row never renumbers the rest.
  const filtered = run
    ? applyDiversity(run.rows.map((row, index) => ({ ...row, rank: index + 1, members: row.memberIndices })), diversity)
        .map((row) => ({ ...row, members: run.rows[row.rank - 1].members }))
    : [];
  const shown = filtered.slice(0, shownCount);

  if (!bundle) return null;
  const combos = owned.length >= 5 ? binomial(owned.length, 5) : 0;
  const canRun = owned.length >= 5 && unlockedLeaders.length > 0 && !progress;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>最佳化</h2>
          <p className="page-sub">
            列舉所有五人組合 × 已解鎖 Leader Outfit，依推薦指數排名。這是隊伍之間的<b>相對</b>比較值，不是遊戲畫面分數。
          </p>
        </div>
      </div>

      <section className="tuning">
        <label className="toggle">
          <input type="checkbox" checked={diversity.oneLeaderPerTeam}
                 onChange={(event) => setDiversity((previous) => ({ ...previous, oneLeaderPerTeam: event.target.checked }))} />
          <span>同一組隊伍只顯示最佳 Leader</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={diversity.minDistinctMembers > 0}
                 onChange={(event) => setDiversity((previous) => ({ ...previous, minDistinctMembers: event.target.checked ? 2 : 0 }))} />
          <span>略過只差一張卡的相似隊伍</span>
        </label>
        <label className="count">
          <span className="count-label">顯示筆數</span>
          <input type="range" min={5} max={30} step={1} value={shownCount}
                 onChange={(event) => setShownCount(Number(event.target.value))} />
          <output>{shownCount}</output>
        </label>
      </section>

      <PinPicker
        owned={owned} pinned={pinned} max={MAX_PINNED} imageUrl={imageUrl}
        onToggle={(cardId) => setPinned((previous) => previous.includes(cardId)
          ? previous.filter((value) => value !== cardId)
          : previous.length < MAX_PINNED ? [...previous, cardId] : previous)}
        onClear={() => setPinned([])}
      />

      {/* The scope and the action that consumes it belong on one line: the
          button described what these numbers are for, so a row of its own was
          only distance. */}
      <div className="runbar">
        <dl className="scope">
          <div><dt>持有卡</dt><dd>{owned.length}</dd></div>
          <div><dt>Leader Outfit</dt><dd>{unlockedLeaders.length}</dd></div>
          <div><dt>五人組合</dt><dd>{combos.toLocaleString()}</dd></div>
          <div><dt>待評估</dt><dd>{(combos * unlockedLeaders.length).toLocaleString()}</dd></div>
          {pinned.length > 0 && <div className="is-pinned"><dt>已指定</dt><dd>{pinned.length} 張</dd></div>}
        </dl>

        <div className="runbar-action">
          {!progress && owned.length < 5 && <p className="hint">先到「我的卡片」勾選至少 5 張。</p>}
          {!progress && owned.length >= 5 && !unlockedLeaders.length && (
            <p className="hint">至少要有一張持有卡開啟 Leader。</p>
          )}
          {progress && (
            <div className="runbar-progress">
              <div className="bar"><i style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
              <span className="pct">{((progress.done / progress.total) * 100).toFixed(0)}%</span>
              <button className="ghost" onClick={() => abortRef.current?.abort()}>取消</button>
            </div>
          )}
          <button className="primary" disabled={!canRun} onClick={start}>
            {progress ? '計算中…' : '計算最佳隊伍'}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {run && (
        <section className="results">
          <div className="results-head">
            <h3>Top {shown.length}</h3>
            <p className="results-stats">
              {run.scored.toLocaleString()} 組符合條件 · {run.seconds.toFixed(1)} 秒
              {filtered.length < run.rows.length && ` · 已略過 ${run.rows.length - filtered.length} 組相似隊伍`}
            </p>
          </div>
          {run.pinned.length > 0 && (
            <p className="pinned-note">
              這份結果限定包含：{run.pinned.map((id) => owned.find((card) => card.id === id)?.name ?? id).join('、')}
            </p>
          )}
          {run.stamp !== stamp && (
            <p className="stale">庫存已變更，這份結果來自先前的 {run.ownedCount} 張卡。重新計算以取得最新結果。</p>
          )}
          <div className="results-list">
            {shown.map((row) => (
              <TeamRow key={row.rank} rank={row.rank} value={row.value} members={row.members}
                       leader={row.leader} imageUrl={imageUrl} best={run.rows[0]?.value ?? 0}
                       breakdown={row.breakdown}
                       onOpenSong={() => onOpenSong(run.rows.indexOf(row))} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
