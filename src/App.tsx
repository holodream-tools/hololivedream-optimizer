/**
 * hololive Dreams team optimizer.
 *
 * Everything runs in the browser: the sweep is sharded across Web Workers and
 * the inventory lives in localStorage, so there is no server and no account.
 */
import { useState } from 'react';
import { useAppState } from './lib/appState';
import { InventoryPage } from './pages/InventoryPage';
import { LibraryPage } from './pages/LibraryPage';
import { ComparePage } from './pages/ComparePage';
import { ManualTeamPage } from './pages/ManualTeamPage';
import { OptimizerPage } from './pages/OptimizerPage';
import { SongPage } from './pages/SongPage';
import { FirstRunHint } from './ui/FirstRunHint';
import { hasStored } from './lib/inventory';
import { decodeTeam } from './lib/share';
import './App.css';

const TABS = [
  { id: 'library', label: '卡片庫', hint: '能力值與技能敘述' },
  { id: 'inventory', label: '我的卡片', hint: '設定持有與命座' },
  { id: 'manual', label: '自選隊伍', hint: '自己挑五張試算' },
  { id: 'optimizer', label: '隊伍最佳化', hint: '找出最強陣容' },
  { id: 'song', label: '歌曲／順序', hint: '指定譜面與站位' },
  { id: 'compare', label: '隊伍比較', hint: 'A / B 逐項對照' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Where a visit starts.
 *
 * Nothing works until some cards are ticked, so a first-time visitor opens on
 * 我的卡片 -- the first step of 我的卡片 → 隊伍最佳化 → 歌曲／順序, and the
 * page the hint above the content points at first.
 *
 * A shared link opens 自選隊伍 instead, because that is where its team lands:
 * the five members, the Leader Outfit and the notice saying where they came
 * from are all on that page, and anywhere else the visitor would have to go
 * looking for what they followed the link to see. `decodeTeam` is the same
 * check the restore itself makes, so a hash that reads here is a hash that
 * restores -- deciding it now rather than after the restore means the page
 * never paints the wrong tab first.
 *
 * Anyone with a saved inventory keeps 卡片庫: they are not a first visit and
 * have already done that step.
 *
 * Read straight from storage rather than from `owned`, so it is decided once,
 * before the first paint, and cannot flip when the catalogue finishes loading.
 */
function openingTab(): TabId {
  if (decodeTeam(window.location.hash)) return 'manual';
  return hasStored() ? 'library' : 'inventory';
}

export default function App() {
  const state = useAppState();
  const [tab, setTab] = useState<TabId>(openingTab);
  const [songTeam, setSongTeam] = useState<number | null>(null);

  const openSong = (index: number) => { setSongTeam(index); setTab('song'); };

  if (state.error && !state.bundle) return <main className="app"><p className="error">{state.error}</p></main>;
  if (!state.bundle) return <main className="app"><p className="loading">載入中…</p></main>;

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <p className="eyebrow">hololive Dreams</p>
          <h1>{TABS.find((entry) => entry.id === tab)!.label}</h1>
        </div>
        <dl className="masthead-stats">
          <div><dt>持有卡</dt><dd>{state.owned.length}</dd></div>
          <div><dt>隊長服裝</dt><dd>{state.unlockedLeaders.length}</dd></div>
        </dl>
      </header>

      <nav className="tabs" aria-label="功能">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            className={tab === entry.id ? 'is-on' : ''}
            aria-current={tab === entry.id ? 'page' : undefined}
            onClick={() => setTab(entry.id)}
          >
            <span className="tab-label">{entry.label}</span>
            <span className="tab-hint">{entry.hint}</span>
          </button>
        ))}
      </nav>

      <main className="page">
        <p className="tagline">
          hololive Dreams 非官方隊伍最佳化工具，可依持有卡、命座與歌曲譜面推薦隊伍、最佳站位並比較隊伍差異。
        </p>
        <FirstRunHint state={state} />
        {state.error && <p className="error">{state.error}</p>}
        {state.newCards.length > 0 && (
          <p className="fresh">
            已載入 {state.newCards.length} 張新卡：
            {state.newCards
              .map((id) => state.bundle!.cards.find((card) => card.id === id)?.name ?? id)
              .join('、')}
            。數值與技能已可使用，卡片圖片會在下次更新時補上。
          </p>
        )}
        {tab === 'inventory' && <InventoryPage state={state} />}
        {tab === 'library' && <LibraryPage state={state} />}
        {tab === 'optimizer' && (
          <OptimizerPage state={state} onOpenSong={openSong} onCompare={() => setTab('compare')} />
        )}
        {tab === 'compare' && <ComparePage state={state} />}
        {tab === 'manual' && <ManualTeamPage state={state} onCompare={() => setTab('compare')} />}
        {tab === 'song' && <SongPage state={state} teamIndex={songTeam} />}
      </main>

      <footer className="footnote">
        全部計算都在你的瀏覽器完成，庫存只存在這台裝置 · 卡片圖片為本機快取，僅供此預覽版檢視版面
      </footer>
    </div>
  );
}
