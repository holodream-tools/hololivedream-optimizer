/**
 * One card: artwork, attribute, Bloom, and ownership in a single control.
 *
 * Three densities for three different jobs:
 *   compact  a portrait-sized row, for ticking off a large collection quickly
 *   normal   card art and the headline numbers
 *   skills   normal plus what the three skills actually do
 *
 * Every artwork slot is optional: `imageUrl` and `portraitUrl` may be undefined
 * and the tile falls back to a typographic panel carrying the same information.
 */
import { activeText, passiveText, specialText } from './skillText';
import { attributeStyle } from './theme';
import type { CardJson } from '../engine/types';
import { memberName } from './members';

export type TileDensity = 'compact' | 'normal' | 'skills';

export interface CardTileProps {
  card: CardJson;
  owned: boolean;
  bloom: number;
  leaderUnlocked: boolean;
  density: TileDensity;
  imageUrl?: string;
  portraitUrl?: string;
  onToggleOwned: () => void;
  onBloom: (bloom: number) => void;
  onToggleLeader: () => void;
}

export function CardTile(props: CardTileProps) {
  const { card, owned, bloom, leaderUnlocked, density, imageUrl, portraitUrl } = props;
  const style = attributeStyle(card.type);
  const blooms = Object.keys(card.blooms).map(Number).sort((a, b) => a - b);
  const stats = card.blooms[String(bloom)] ?? card.blooms[String(card.maxBloom)];
  const power = stats ? stats.performance + stats.technique + stats.sense : 0;
  const accent = {
    ['--accent' as string]: style.accent,
    ['--accent-soft' as string]: style.soft,
    ['--accent-line' as string]: style.line,
  };

  const bloomSteps = (
    <div className="bloom-steps" role="group" aria-label={`${memberName(card)} 的命座`}>
      <span className="bloom-label">命座</span>
      {blooms.map((value) => (
        <button key={value} type="button" className={value === bloom ? 'is-on' : ''}
                disabled={!owned} aria-pressed={value === bloom}
                onClick={() => props.onBloom(value)}>{value}</button>
      ))}
    </div>
  );

  const leaderToggle = (
    <label className={`tile-leader${leaderUnlocked ? ' is-on' : ''}`}>
      <input type="checkbox" checked={leaderUnlocked} onChange={props.onToggleLeader} disabled={!owned} />
      <span>Leader</span>
    </label>
  );

  if (density === 'compact') {
    return (
      <article className={`row${owned ? ' is-owned' : ''}`} style={accent}>
        <button type="button" className="row-face" aria-pressed={owned}
                aria-label={`${owned ? '取消持有' : '設為持有'}：${memberName(card)}`}
                onClick={props.onToggleOwned}>
          {portraitUrl
            ? <img src={portraitUrl} alt="" loading="lazy" />
            : <span className="row-initial">{style.label.charAt(0)}</span>}
          {owned && <span className="row-check" aria-hidden="true">✓</span>}
        </button>
        <div className="row-body">
          <p className="row-name">{memberName(card)}</p>
          <p className="row-title">{card.title || '—'}</p>
        </div>
        <span className="row-power">{power.toLocaleString()}</span>
        <div className="row-controls">{bloomSteps}{leaderToggle}</div>
      </article>
    );
  }

  return (
    <article className={`tile${owned ? ' is-owned' : ''}`} style={accent}>
      <button type="button" className="tile-art" aria-pressed={owned}
              aria-label={`${owned ? '取消持有' : '設為持有'}：${memberName(card)}${card.title ? `「${card.title}」` : ''}`}
              onClick={props.onToggleOwned}>
        {imageUrl
          ? <img src={imageUrl} alt="" loading="lazy" width={192} height={108} />
          : <span className="tile-noart">{style.label}</span>}
        <span className="tile-badge">{style.label}</span>
        {owned && <span className="tile-check" aria-hidden="true">✓</span>}
      </button>

      <div className="tile-body">
        <p className="tile-name">{memberName(card)}</p>
        <p className="tile-title">{card.title || '—'}</p>
        <p className="tile-meta">
          <span>{card.generation}</span>
          <span className="tile-power">{power.toLocaleString()}</span>
        </p>
      </div>

      {density === 'skills' && (
        <dl className="tile-skills">
          {([['P', passiveText(stats?.support)], ['A', activeText(stats?.active)],
             ['SP', specialText(stats?.special)]] as const).map(([label, text]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{text ?? <span className="tile-skill-none">—</span>}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="tile-controls">{bloomSteps}{leaderToggle}</div>
    </article>
  );
}
