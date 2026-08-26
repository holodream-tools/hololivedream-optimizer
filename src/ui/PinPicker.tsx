/**
 * Pin cards that every candidate team must contain.
 *
 * Pinning is what turns the sweep from "show me the best team" into "show me the
 * best team that uses these cards", which is the question a player with a
 * favourite actually has.
 */
import { useMemo, useState } from 'react';
import { attributeStyle } from './theme';
import type { CardJson } from '../engine/types';

export interface PinPickerProps {
  owned: CardJson[];
  pinned: string[];
  max: number;
  imageUrl: (card: CardJson) => string | undefined;
  onToggle: (cardId: string) => void;
  onClear: () => void;
}

export function PinPicker({ owned, pinned, max, imageUrl, onToggle, onClear }: PinPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return owned.filter((card) => !needle || `${card.name}${card.title}`.toLowerCase().includes(needle));
  }, [owned, query]);

  const pinnedCards = pinned
    .map((id) => owned.find((card) => card.id === id))
    .filter((card): card is CardJson => !!card);

  return (
    <section className="pin">
      <header className="pin-head">
        <div>
          <h3>指定必須上場的卡<span className="pin-count">{pinned.length} / {max}</span></h3>
          <p className="pin-sub">被指定的卡一定會在隊伍中，其餘空位由計算補齊。</p>
        </div>
        <div className="pin-actions">
          {pinned.length > 0 && <button className="ghost" onClick={onClear}>清除</button>}
          <button onClick={() => setOpen((value) => !value)} disabled={!owned.length}>
            {open ? '收合' : '選擇卡片'}
          </button>
        </div>
      </header>

      {pinnedCards.length > 0 && (
        <ul className="pin-list">
          {pinnedCards.map((card) => {
            const style = attributeStyle(card.type);
            const url = imageUrl(card);
            return (
              <li key={card.id} style={{ ['--accent' as string]: style.accent, ['--accent-line' as string]: style.line }}>
                {url ? <img src={url} alt="" width={192} height={108} />
                     : <span className="slot-noart">{style.label}</span>}
                <span className="pin-name">{card.name}</span>
                <button className="pin-remove" onClick={() => onToggle(card.id)}
                        aria-label={`取消指定 ${card.name}`}>×</button>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <div className="pin-picker">
          <input type="search" value={query} placeholder="搜尋持有卡"
                 onChange={(event) => setQuery(event.target.value)} />
          <div className="pin-grid">
            {candidates.map((card) => {
              const style = attributeStyle(card.type);
              const chosen = pinned.includes(card.id);
              const url = imageUrl(card);
              return (
                <button key={card.id} className={`pin-option${chosen ? ' is-on' : ''}`}
                        style={{ ['--accent' as string]: style.accent, ['--accent-line' as string]: style.line, ['--accent-soft' as string]: style.soft }}
                        disabled={!chosen && pinned.length >= max}
                        onClick={() => onToggle(card.id)}
                        title={`${card.name}${card.title ? `「${card.title}」` : ''}`}>
                  {url ? <img src={url} alt="" width={192} height={108} />
                       : <span className="slot-noart">{style.label}</span>}
                  <span className="pin-option-name">{card.name}</span>
                </button>
              );
            })}
          </div>
          {!candidates.length && <p className="empty">沒有符合的持有卡。</p>}
        </div>
      )}
    </section>
  );
}
