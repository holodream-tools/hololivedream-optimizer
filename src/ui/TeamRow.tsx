/** One ranked team: its score, its Leader Outfit, and the five members. */
import { useState } from 'react';
import { attributeStyle } from './theme';
import { PassiveConditions } from './PassiveConditions';
import { CardArt } from './CardArt';
import type { CardJson, LeaderJson } from '../engine/types';
import type { ImageSource } from '../lib/images';
import { leaderName, memberName } from './members';

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
  images: ImageSource | null | undefined;
  /** Score of the best team, for the relative bar. */
  best: number;
  /** Opens this team on the song page, when the caller supports it. */
  onOpenSong?: () => void;
  /** Sends this team to the compare page; the label names the slot it lands in. */
  onCompare?: () => void;
  compareLabel?: string;
  /** Bloom lookup, so the expanded panel can resolve each card's own skill. */
  bloomOf?: (cardId: string) => number;
  breakdown?: TeamBreakdown;
}

/** `白銀ノエル（波まとうゆるふわKnight）` -> name and costume, separately. */
function splitLeaderName(value: string): [string, string] {
  const open = value.indexOf('（');
  if (open < 0) return [value, ''];
  return [value.slice(0, open), value.slice(open + 1).replace(/）$/, '')];
}

export function TeamRow({ rank, value, members, leader, images, best, onOpenSong,
                         onCompare, compareLabel, bloomOf, breakdown }: TeamRowProps) {
  const [open, setOpen] = useState(false);
  const share = best > 0 ? value / best : 0;

  // The Outfit is its own slot: it lends a costume skill whether or not that card
  // is also one of the five. Showing it separately every time keeps one layout
  // for both cases, and makes the two roles legible rather than conflated.
  const leaderCardId = leader.id.replace(/^outfit:/, '');
  const [leaderTalent, leaderCostume] = splitLeaderName(leaderName(leader));
  const leaderAlsoPlays = members.some((card) => card.id === leaderCardId);

  return (
    <article className={`team${rank === 1 ? ' is-best' : ''}`}>
      <div className="team-head">
        <span className="team-rank">{rank}</span>
        <div className="team-score">
          <b title="綜合推薦指數：用於隊伍強弱比較的估算指標，非實際 Live 分數">
            {Math.round(value).toLocaleString()}
          </b>
          <span className="team-share">{(share * 100).toFixed(1)}%</span>
        </div>
        <div className="team-bar" aria-hidden="true"><i style={{ width: `${share * 100}%` }} /></div>
        <p className="team-actions">
          {breakdown && (
            <button type="button" className="team-why" aria-expanded={open}
                    onClick={() => setOpen((value) => !value)}>
              {open ? '收合組成' : '這個數字怎麼來的'}
            </button>
          )}
          {onCompare && (
            <button type="button" className="team-compare" onClick={onCompare}>
              比較 {compareLabel}
            </button>
          )}
          {onOpenSong && (
            <button type="button" className="team-song" onClick={onOpenSong}>指定歌曲 →</button>
          )}
        </p>
      </div>

      <ol className="team-members">
        <li className="is-leader">
          <span className="leader-crest">隊長</span>
          <CardArt images={images} cardId={leaderCardId} width={192} height={108}
                   noArtClassName="team-noart" noArtLabel="隊長服裝" />
          <span className="team-member-name">{leaderTalent}</span>
          <span className="team-member-title">{leaderCostume || '—'}</span>
          <span className="leader-role">{leaderAlsoPlays ? '服裝＋上場' : '僅提供服裝'}</span>
        </li>

        {members.map((card, slot) => {
          const style = attributeStyle(card.type);
          return (
            <li key={`${card.id}-${slot}`}
                style={{ ['--accent' as string]: style.accent, ['--accent-line' as string]: style.line }}>
              <CardArt images={images} cardId={card.id} width={192} height={108}
                       noArtClassName="team-noart" noArtLabel={style.label} />
              <span className="team-member-name">{memberName(card)}</span>
              <span className="team-member-title">{card.title || '—'}</span>
            </li>
          );
        })}
      </ol>

      {breakdown && open && (
        <div className="team-breakdown">
          <ol className="chain">
            <li><span>五張卡基礎能力</span><b>{breakdown.basePower.toLocaleString()}</b></li>
            <li><span>被動／隊長服裝加成後</span><b>{breakdown.totalPower.toLocaleString()}</b></li>
            <li><span>× 主動技能期望倍率</span><b>{(value / (breakdown.totalPower || 1)).toFixed(3)}</b></li>
            <li className="is-result"><span>綜合推薦指數</span><b>{Math.round(value).toLocaleString()}</b></li>
          </ol>
          <dl className="chain-parts">
            <div><dt>主動技能期望</dt><dd>+{breakdown.activeScoreUp.toFixed(1)}%</dd></div>
            <div><dt>被動技能分數支援</dt><dd>+{breakdown.passiveSupport.toFixed(0)}</dd></div>
            <div><dt>隊長服裝分數支援</dt><dd>+{breakdown.leaderSupport.toFixed(0)}</dd></div>
            <div><dt>特殊技能時間平均</dt><dd>+{breakdown.specialSupport.toFixed(1)}</dd></div>
          </dl>
          {bloomOf && <PassiveConditions members={members} leader={leader} bloomOf={bloomOf} />}
          <p className="chain-note">
            分數支援本身不會加分，只在主動技能生效時放大它；特殊技能以 192 秒的參考長度取平均。綜合推薦指數是用來快速比較大量隊伍的相對值，不是實際 Live 分數；想看分數請到「歌曲／順序」。
          </p>
        </div>
      )}
    </article>
  );
}
