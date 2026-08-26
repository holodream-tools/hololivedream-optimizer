/** 卡片庫 — every card and what its three skills actually do, at each Bloom. */
import { useMemo, useState } from 'react';
import { activeText, outfitText, passiveText, specialText } from '../ui/skillText';
import { ATTRIBUTES, attributeStyle } from '../ui/theme';
import type { AppState } from '../lib/appState';

export function LibraryPage({ state }: { state: AppState }) {
  const { bundle, images } = state;
  const [query, setQuery] = useState('');
  const [attribute, setAttribute] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bloom, setBloom] = useState<number | null>(null);

  const visible = useMemo(() => {
    if (!bundle) return [];
    const needle = query.trim().toLowerCase();
    return bundle.cards.filter((card) => {
      if (attribute && card.type.toLowerCase() !== attribute) return false;
      return !needle || `${card.name}${card.title}`.toLowerCase().includes(needle);
    });
  }, [bundle, query, attribute]);

  const selected = bundle?.cards.find((card) => card.id === (selectedId ?? visible[0]?.id));
  const leader = bundle?.leaders.find((row) => row.id === `outfit:${selected?.id}`);
  if (!bundle || !selected) return null;

  const blooms = Object.keys(selected.blooms).map(Number).sort((a, b) => a - b);
  const shown = bloom !== null && selected.blooms[String(bloom)] ? bloom : selected.maxBloom;
  const data = selected.blooms[String(shown)];
  const style = attributeStyle(selected.type);
  const power = data ? data.performance + data.technique + data.sense : 0;

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
          {visible.map((card) => {
            const rowStyle = attributeStyle(card.type);
            return (
              <li key={card.id}>
                <button className={card.id === selected.id ? 'is-on' : ''}
                        style={{ ['--accent' as string]: rowStyle.accent }}
                        onClick={() => { setSelectedId(card.id); setBloom(null); }}>
                  <span className="card-list-name">{card.name}</span>
                  <span className="card-list-title">{card.title || '—'}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <article className="detail" style={{ ['--accent' as string]: style.accent, ['--accent-soft' as string]: style.soft, ['--accent-line' as string]: style.line }}>
          {images?.url(selected.id)
            ? <img className="detail-art" src={images.url(selected.id)} alt="" width={192} height={108} />
            : <div className="detail-noart">{style.label}</div>}

          <header className="detail-head">
            <p className="detail-badge">{style.label} · {selected.generation}</p>
            <h3>{selected.name}</h3>
            <p className="detail-title">{selected.title || '—'}</p>
          </header>

          <div className="detail-blooms">
            <span>Bloom</span>
            {blooms.map((value) => (
              <button key={value} className={value === shown ? 'is-on' : ''} onClick={() => setBloom(value)}>{value}</button>
            ))}
          </div>

          <dl className="detail-stats">
            <div><dt>Performance</dt><dd>{data?.performance.toLocaleString() ?? '—'}</dd></div>
            <div><dt>Technique</dt><dd>{data?.technique.toLocaleString() ?? '—'}</dd></div>
            <div><dt>Sense</dt><dd>{data?.sense.toLocaleString() ?? '—'}</dd></div>
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
      </div>
    </>
  );
}
