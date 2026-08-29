/** 我的卡片 — own, level, and unlock the Leader Outfit for every card. */
import { useMemo, useState } from 'react';
import { CardTile, type TileDensity } from '../ui/CardTile';
import { ATTRIBUTES, attributeStyle } from '../ui/theme';
import type { AppState } from '../lib/appState';
import type { CardJson } from '../engine/types';
import { compareCards, memberName, searchIndex, sortedGenerations } from '../ui/members';
import { branchLabel } from '../ui/members';

type Sort = 'power' | 'name' | 'generation';

export function InventoryPage({ state }: { state: AppState }) {
  const { bundle, images, inventory } = state;
  const [query, setQuery] = useState('');
  const [generation, setGeneration] = useState('');
  const [attribute, setAttribute] = useState('');
  const [ownedOnly, setOwnedOnly] = useState(false);
  // Catalogue order by default: it matches the branch filter above the grid,
  // so the list a player scans is in the order they think of the roster.
  const [sort, setSort] = useState<Sort>('generation');
  const [density, setDensity] = useState<TileDensity>('normal');

  const generations = useMemo(
    () => (bundle ? sortedGenerations(bundle.cards) : []),
    [bundle],
  );

  const visible = useMemo(() => {
    if (!bundle) return [];
    const needle = query.trim().toLowerCase();
    const rows = bundle.cards.filter((card) => {
      if (generation && card.generation !== generation) return false;
      if (attribute && card.type.toLowerCase() !== attribute) return false;
      if (ownedOnly && !inventory.get(card.id)?.owned) return false;
      return !needle || searchIndex(card).includes(needle);
    });
    // Ranked on the card's own ceiling, not on the Bloom currently selected:
    // sorting by live values would reshuffle the grid under the cursor every
    // time a Bloom is changed.
    const powerOf = (card: CardJson) => {
      const stats = card.blooms[String(card.maxBloom)];
      return stats ? stats.performance + stats.technique + stats.sense : 0;
    };
    const compare = {
      power: (a: CardJson, b: CardJson) => powerOf(b) - powerOf(a),
      // Sorts on what is displayed, which for ID and EN members is English.
      name: (a: CardJson, b: CardJson) =>
        memberName(a).localeCompare(memberName(b), 'ja') || a.id.localeCompare(b.id, 'en'),
      generation: compareCards,
    }[sort];
    return [...rows].sort(compare);
    // `inventory` is read only for the owned-only filter; sorting deliberately
    // does not depend on it, so editing a card never moves it.
  }, [bundle, inventory, query, generation, attribute, ownedOnly, sort]);

  if (!bundle) return null;
  const ownedVisible = visible.filter((card) => inventory.get(card.id)?.owned);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>我的卡片</h2>
          <p className="page-sub">勾選你實際擁有的卡，設定 Bloom，並開啟可用的隊長服裝。</p>
        </div>
        <p className="page-count">{visible.length} / {bundle.cards.length} 張</p>
      </div>

      <div className="filters">
        <input type="search" value={query} placeholder="搜尋成員或卡片名稱"
               onChange={(event) => setQuery(event.target.value)} />
        <select value={generation} onChange={(event) => setGeneration(event.target.value)}>
          <option value="">全部期生</option>
          {generations.map((value) => (
            <option key={value} value={value}>{branchLabel(value)}</option>
          ))}
        </select>
        <div className="attr-filter" role="group" aria-label="屬性篩選">
          <button className={attribute === '' ? 'is-on' : ''} onClick={() => setAttribute('')}>全部</button>
          {ATTRIBUTES.map((value) => {
            const style = attributeStyle(value);
            return (
              <button key={value} className={attribute === value ? 'is-on' : ''}
                      style={{ ['--accent' as string]: style.accent, ['--accent-soft' as string]: style.soft, ['--accent-line' as string]: style.line }}
                      onClick={() => setAttribute(attribute === value ? '' : value)}>{style.label}</button>
            );
          })}
        </div>
        <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          <option value="power">依滿命座總合力排序</option>
          <option value="name">依成員名排序</option>
          <option value="generation">依期生排序</option>
        </select>
        <label className="toggle">
          <input type="checkbox" checked={ownedOnly} onChange={(event) => setOwnedOnly(event.target.checked)} />
          <span>只看持有</span>
        </label>
        <div className="density" role="group" aria-label="顯示密度">
          {([['compact', '清單'], ['normal', '卡片'], ['skills', '卡片＋技能']] as const).map(([value, label]) => (
            <button key={value} className={density === value ? 'is-on' : ''}
                    onClick={() => setDensity(value)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="bulk">
        <span className="bulk-label">批次（作用於目前顯示的 {visible.length} 張）：</span>
        <button onClick={() => state.bulk(visible, { owned: 1 }, true)}>全設為持有</button>
        <button onClick={() => state.bulk(visible, { owned: 0, leader_unlocked: 0 })}>全部取消</button>
        <button disabled={!ownedVisible.length}
                onClick={() => state.bulk(ownedVisible, { leader_unlocked: 1 })}>持有者開啟隊長服裝</button>
        <button disabled={!ownedVisible.length}
                onClick={() => state.bulk(ownedVisible, {}, true)}>持有者全設滿命座</button>
        <button disabled={!ownedVisible.length}
                onClick={() => state.bulk(ownedVisible, { bloom: 0 })}>持有者全設 0 命座</button>
        <span className="bulk-spacer" />
        <button onClick={state.exportInventory}>匯出</button>
        <label className="file">
          匯入
          <input type="file" accept="application/json" onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) state.importInventory(await file.text());
            event.target.value = '';
          }} />
        </label>
        {/* Destructive and unrecoverable without an export, so it asks first. */}
        <button className="danger" onClick={() => {
          if (window.confirm('清除這台裝置上儲存的持有卡、命座、自選隊伍與偏好設定？\n這無法復原，除非你先匯出過備份。')) {
            state.clearSaved();
          }
        }}>清除已儲存設定</button>
      </div>

      <div className={density === 'compact' ? 'rows' : 'grid'}>
        {visible.map((card) => {
          const row = inventory.get(card.id)!;
          return (
            <CardTile
              key={card.id} card={card} density={density}
              owned={!!row.owned} bloom={row.bloom} leaderUnlocked={!!row.leader_unlocked}
              images={images} portraitUrl={images?.portrait(card.id)}
              onToggleOwned={() => state.patch(card.id, row.owned ? { owned: 0, leader_unlocked: 0 } : { owned: 1 })}
              onBloom={(bloom) => state.patch(card.id, { bloom })}
              onToggleLeader={() => state.patch(card.id, { leader_unlocked: row.leader_unlocked ? 0 : 1 })}
            />
          );
        })}
      </div>
      {!visible.length && <p className="empty">沒有符合條件的卡片。</p>}
    </>
  );
}
