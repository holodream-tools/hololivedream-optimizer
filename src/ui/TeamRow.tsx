/** One ranked team: its score, its Leader Outfit, and the five members. */
import { useState } from 'react';
import { attributeStyle } from './theme';
import type { CardJson, LeaderJson } from '../engine/types';

/** How the index was assembled, so the number is not just asserted. */
export interface TeamBreakdown {
  basePower: number;
  totalPower: number;
  activeScoreUp: number;
  passiveSupport: number;
  leaderSupport: number;
  specialSupport: number;
}

export interface TeamRowProps {
  rank: number;
  value: number;
  members: CardJson[];
  leader: LeaderJson;
  imageUrl: (card: CardJson) => string | undefined;
  /** Score of the best team, for the relative bar. */
  best: number;
  /** Opens this team on the song page, when the caller supports it. */
  onOpenSong?: () => void;
  breakdown?: TeamBreakdown;
}

export function TeamRow({ rank, value, members, leader, imageUrl, best, onOpenSong, breakdown }: TeamRowProps) {
  const [open, setOpen] = useState(false);
  const share = best > 0 ? value / best : 0;
  return (
    <article className={`team${rank === 1 ? ' is-best' : ''}`}>
      <div className="team-head">
        <span className="team-rank">{rank}</span>
        <div className="team-score">
          <b>{Math.round(value).toLocaleString()}</b>
          <span className="team-share">{(share * 100).toFixed(1)}%</span>
        </div>
        <div className="team-bar" aria-hidden="true"><i style={{ width: `${share * 100}%` }} /></div>
        <p className="team-leader">
          <span className="team-leader-tag">Leader</span>
          {leader.name}
          {breakdown && (
            <button type="button" className="team-why" aria-expanded={open}
                    onClick={() => setOpen((value) => !value)}>
              {open ? '收合組成' : '這個數字怎麼來的'}
            </button>
          )}
          {onOpenSong && (
            <button type="button" className="team-song" onClick={onOpenSong}>指定歌曲 →</button>
          )}
        </p>
      </div>
      <ol className="team-members">
        {members.map((card, slot) => {
          const style = attributeStyle(card.type);
          const url = imageUrl(card);
          return (
            <li key={`${card.id}-${slot}`} style={{ ['--accent' as string]: style.accent, ['--accent-line' as string]: style.line }}>
              {url
                ? <img src={url} alt="" loading="lazy" width={192} height={108} />
                : <span className="team-noart">{style.label}</span>}
              <span className="team-member-name">{card.name}</span>
              <span className="team-member-title">{card.title || '—'}</span>
            </li>
          );
        })}
      </ol>

      {breakdown && open && (
        <div className="team-breakdown">
          <ol className="chain">
            <li><span>五張卡基礎三圍</span><b>{breakdown.basePower.toLocaleString()}</b></li>
            <li><span>Passive／Outfit 加成後</span><b>{breakdown.totalPower.toLocaleString()}</b></li>
            <li><span>× Active 期望倍率</span><b>{(value / (breakdown.totalPower || 1)).toFixed(3)}</b></li>
            <li className="is-result"><span>推薦指數</span><b>{Math.round(value).toLocaleString()}</b></li>
          </ol>
          <dl className="chain-parts">
            <div><dt>Active 期望</dt><dd>+{breakdown.activeScoreUp.toFixed(1)}%</dd></div>
            <div><dt>Passive Score Support</dt><dd>+{breakdown.passiveSupport.toFixed(0)}</dd></div>
            <div><dt>Outfit Score Support</dt><dd>+{breakdown.leaderSupport.toFixed(0)}</dd></div>
            <div><dt>Special 時間平均</dt><dd>+{breakdown.specialSupport.toFixed(1)}</dd></div>
          </dl>
          <p className="chain-note">
            Score Support 沒有獨立分數，只在 Active 生效時放大它；Special 以 192 秒參考長度做時間平均。
            這是隊伍之間的相對比較值，實際分數請用「歌曲／順序」。
          </p>
        </div>
      )}
    </article>
  );
}
