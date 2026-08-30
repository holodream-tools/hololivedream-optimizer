/**
 * How many Activation Frequency Up nodes each member of a named five should
 * unlock for the song being looked at.
 *
 * Shown wherever a page has both a fixed five and a chart -- 自選隊伍's song
 * evaluation, and both modes of 歌曲／順序 -- from one component so the three
 * cannot drift apart in wording or in what they assume.
 */
import { NODE_PERCENT } from '../engine/frequencyBoard';
import { memberName } from './members';
import type { CardJson } from '../engine/types';

export function FrequencyNodes(
  { members, nodes }: { members: CardJson[]; nodes: number[] | null },
) {
  if (!nodes || nodes.length !== members.length) return null;
  return (
    <section className="freq-nodes">
      <h4>
        主動技能發動頻率提升建議
        <span>以下建議以角色前置面板已培養完成、主動技能發動率提升已納入計算為基準。</span>
      </h4>
      <ul>
        {members.map((card, member) => (
          <li key={`${card.id}-${member}`}>
            <span className="freq-name">{memberName(card)}</span>
            <span className="freq-pick">+{NODE_PERCENT}% ×{nodes[member]}</span>
          </li>
        ))}
      </ul>
      <p className="metric-note">
        發動頻率並非越高越好；縮短發動間隔會改變技能時機，部分歌曲也可能增加判定次數，
        但技能重疊仍可能讓整體效果下降。計算採社群推定公式，且目前未納入 Connect 卡加成。
      </p>
    </section>
  );
}
