/** 卡片庫 — every card and what its three skills actually do, at each Bloom. */
import { useMemo, useState } from 'react';
import { activeText, outfitText, passiveText, specialText } from '../ui/skillText';
import { ATTRIBUTES, attributeStyle } from '../ui/theme';
import type { AppState } from '../lib/appState';
import type { CardBundle, CardJson } from '../engine/types';
import { branchLabel, compareCards, memberName, searchIndex, sortedGenerations } from '../ui/members';

export function LibraryPage({ state }: { state: AppState }) {
  const { bundle, images } = state;
  const [query, setQuery] = useState('');
  const [attribute, setAttribute] = useState('');
  const [generation, setGeneration] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bloom, setBloom] = useState<number | null>(null);

  const visible = useMemo(() => {
    if (!bundle) return [];
    const needle = query.trim().toLowerCase();
    // Same order as the branch filter reads: JP by debut, then ID, then EN.
    return bundle.cards.filter((card) => {
      if (generation && card.generation !== generation) return false;
      if (attribute && card.type.toLowerCase() !== attribute) return false;
      return !needle || searchIndex(card).includes(needle);
    }).sort(compareCards);
  }, [bundle, query, attribute, generation]);

  const generations = useMemo(() => (bundle ? sortedGenerations(bundle.cards) : []), [bundle]);

  if (!bundle) return null;

  /**
   * Always a card the current filter actually shows, or nothing.
   *
   * This used to resolve against the whole catalogue and the page returned null
   * when it came up empty -- which is what a search matching nothing produced
   * before anything had been selected, so typing one letter unmounted the entire
   * page rather than showing "no matches".
   */
  const selected = visible.find((card) => card.id === selectedId) ?? visible[0] ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>卡片庫</h2>
          <p className="page-sub">全部 {bundle.cards.length} 張卡的能力值與技能敘述，可切換 Bloom 比較。</p>
        </div>
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
            const attrStyle = attributeStyle(value);
            return (
              <button key={value} className={attribute === value ? 'is-on' : ''}
                      style={{ ['--accent' as string]: attrStyle.accent, ['--accent-soft' as string]: attrStyle.soft, ['--accent-line' as string]: attrStyle.line }}
                      onClick={() => setAttribute(attribute === value ? '' : value)}>{attrStyle.label}</button>
            );
          })}
        </div>
        <span className="page-count">{visible.length} 張</span>
      </div>

      <div className="library-split">
        <ol className="card-list">
          {!visible.length && <li className="card-list-empty">沒有符合的卡片。</li>}
          {visible.map((card) => {
            const rowStyle = attributeStyle(card.type);
            return (
              <li key={card.id}>
                <button className={card.id === selected?.id ? 'is-on' : ''}
                        style={{ ['--accent' as string]: rowStyle.accent }}
                        onClick={() => { setSelectedId(card.id); setBloom(null); }}>
                  <span className="card-list-name">{memberName(card)}</span>
                  <span className="card-list-title">{card.title || '—'}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {selected
          ? <CardDetail card={selected} bundle={bundle} images={images} bloom={bloom} setBloom={setBloom} />
          : <p className="empty">換個關鍵字試試，或把期生／屬性篩選清掉。</p>}
      </div>
    </>
  );
}

/** The right-hand panel. Split out so it only ever runs with a card in hand. */
function CardDetail({ card: selected, bundle, images, bloom, setBloom }: {
  card: CardJson; bundle: CardBundle; images: AppState['images'];
  bloom: number | null; setBloom: (value: number) => void;
}) {
  const leader = bundle.leaders.find((row) => row.id === `outfit:${selected.id}`);
  const blooms = Object.keys(selected.blooms).map(Number).sort((a, b) => a - b);
  const shown = bloom !== null && selected.blooms[String(bloom)] ? bloom : selected.maxBloom;
  const data = selected.blooms[String(shown)];
  const style = attributeStyle(selected.type);
  const power = data ? data.performance + data.technique + data.sense : 0;

  return (
        <article className="detail" style={{ ['--accent' as string]: style.accent, ['--accent-soft' as string]: style.soft, ['--accent-line' as string]: style.line }}>
          {images?.url(selected.id)
            ? <img className="detail-art" src={images.url(selected.id)} alt="" width={192} height={108} />
            : <div className="detail-noart">{style.label}</div>}

          <header className="detail-head">
            <p className="detail-badge">{style.label} · {branchLabel(selected.generation)}</p>
            <h3>{memberName(selected)}</h3>
            <p className="detail-title">{selected.title || '—'}</p>
          </header>

          <div className="detail-blooms">
            <span>Bloom</span>
            {blooms.map((value) => (
              <button key={value} className={value === shown ? 'is-on' : ''} onClick={() => setBloom(value)}>{value}</button>
            ))}
          </div>

          <dl className="detail-stats">
            <div><dt>表現力</dt><dd>{data?.performance.toLocaleString() ?? '—'}</dd></div>
            <div><dt>技巧</dt><dd>{data?.technique.toLocaleString() ?? '—'}</dd></div>
            <div><dt>品味</dt><dd>{data?.sense.toLocaleString() ?? '—'}</dd></div>
            <div className="is-total"><dt>總合力</dt><dd>{power.toLocaleString()}</dd></div>
          </dl>

          <div className="detail-skills">
            {([
              ['Passive', passiveText(data?.support)],
              ['Active', activeText(data?.active)],
              ['Special', specialText(data?.special)],
              ['Leader Outfit', outfitText(leader?.outfits[String(shown)])],
            ] as const).map(([label, text]) => (
              <section key={label}>
                <h4>{label}</h4>
                <p>{text ?? <span className="detail-none">此 Bloom 沒有資料</span>}</p>
              </section>
            ))}
          </div>
        </article>
  );
}
