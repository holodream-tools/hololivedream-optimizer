/**
 * One line telling a first-time visitor which order the tabs go in.
 *
 * Deliberately a strip of text and nothing more: no modal, no overlay, no
 * step-by-step tour. Someone who already knows the tool should be able to
 * ignore it, and someone who does not should get the whole answer without
 * clicking anything.
 *
 * Two ways out, because they mean different things. 關閉 hides it for this
 * visit and is React state; 不再顯示 is a preference and goes to localStorage,
 * so it survives a reload and comes back only if the player clears their saved
 * settings.
 */
import { useState } from 'react';
import type { AppState } from '../lib/appState';

export function FirstRunHint({ state }: { state: AppState }) {
  const [closed, setClosed] = useState(false);
  if (closed || state.prefs.hintDismissed) return null;

  return (
    <aside className="firstrun" aria-label="使用提示">
      <p>
        <b>第一次使用？</b>
        先到「我的卡片」設定持有卡，再到「隊伍最佳化」找推薦隊伍，
        最後可到「歌曲／順序」分析指定歌曲。
      </p>
      <div className="firstrun-actions">
        <button type="button" className="ghost"
                onClick={() => state.setPrefs({ hintDismissed: true })}>
          不再顯示
        </button>
        <button type="button" className="ghost firstrun-close"
                onClick={() => setClosed(true)} aria-label="關閉提示">
          ✕
        </button>
      </div>
    </aside>
  );
}
