/**
 * Which conditional skills this team actually switched on.
 *
 * A conditional Passive that failed its condition contributes nothing, and the
 * team screen gives no hint of it: the card is there, the skill text is there,
 * and the number is quietly missing. This lists them, says which fired, and for
 * the ones that did not, says what is short and by how much.
 *
 * The test is `conditionMet` from the engine -- the same call the scoring uses,
 * against counts taken the same way -- so this panel cannot say "triggered"
 * about something the score treated as off.
 */
import { conditionMet } from '../engine/overallScore';
import { passiveText, outfitText } from './skillText';
import type { CardJson, LeaderJson, OutfitCondition } from '../engine/types';
import { leaderName, memberName } from './members';

export interface PassiveConditionsProps {
  members: CardJson[];
  leader: LeaderJson;
  bloomOf: (cardId: string) => number;
}

const ATTRIBUTE: Record<string, string> = { cute: 'Cute', happy: 'Happy', pure: 'Pure' };

interface Row {
  key: string;
  who: string;
  text: string;
  met: boolean;
  /** Why it failed, in the player's terms. Empty when it fired. */
  reason: string;
}

/** "需要 Pure ≥2，目前只有 1" -- the shortfall, not just the requirement. */
function shortfall(condition: OutfitCondition,
                   typeCounts: Map<string, number>,
                   generationCounts: Map<string, number>): string {
  const need = condition.min_count ?? 0;
  if (condition.type === 'type_count') {
    const name = String(condition.type_name ?? '').toLowerCase();
    const have = typeCounts.get(name) ?? 0;
    return `需要 ${ATTRIBUTE[name] ?? name} ≥${need}，目前只有 ${have}`;
  }
  if (condition.type === 'group_count') {
    const have = generationCounts.get(String(condition.group)) ?? 0;
    return `需要 ${condition.group} ≥${need}，目前只有 ${have}`;
  }
  return '條件不成立';
}

export function PassiveConditions({ members, leader, bloomOf }: PassiveConditionsProps) {
  const typeCounts = new Map<string, number>();
  const generationCounts = new Map<string, number>();
  for (const card of members) {
    const type = card.type.toLowerCase();
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    generationCounts.set(card.generation, (generationCounts.get(card.generation) ?? 0) + 1);
  }

  const rows: Row[] = [];
  for (const card of members) {
    const bloom = card.blooms[String(bloomOf(card.id))] ?? card.blooms[String(card.maxBloom)];
    const passive = bloom?.support;
    const condition = (passive?.condition ?? null) as OutfitCondition | null;
    if (!passive || !condition) continue;      // unconditional: nothing to report
    const met = conditionMet(condition, typeCounts, generationCounts);
    rows.push({
      key: `card-${card.id}`,
      who: memberName(card),
      text: passiveText(passive) ?? '——',
      met,
      reason: met ? '' : shortfall(condition, typeCounts, generationCounts),
    });
  }

  const leaderCard = leader.id.replace(/^outfit:/, '');
  const payload = leader.outfits[String(bloomOf(leaderCard))] ?? leader.outfits[String(leader.maxBloom)];
  const outfitCondition = (payload?.condition ?? null) as OutfitCondition | null;
  if (payload && outfitCondition) {
    const met = conditionMet(outfitCondition, typeCounts, generationCounts);
    rows.push({
      key: 'outfit',
      who: `${leaderName(leader)}（隊長服裝）`,
      text: outfitText(payload) ?? '——',
      met,
      reason: met ? '' : shortfall(outfitCondition, typeCounts, generationCounts),
    });
  }

  if (!rows.length) return null;
  const missing = rows.filter((row) => !row.met).length;

  return (
    <section className="conds">
      <h4>
        條件技能
        <span>
          {missing === 0
            ? `${rows.length} 項全部觸發`
            : `${rows.length} 項中有 ${missing} 項未觸發`}
        </span>
      </h4>
      <ul>
        {rows.map((row) => (
          <li key={row.key} className={row.met ? 'is-met' : 'is-unmet'}>
            <span className="conds-flag">{row.met ? '✓ 已觸發' : '⚠ 未觸發'}</span>
            <span className="conds-who">{row.who}</span>
            <span className="conds-text">{row.text}</span>
            {!row.met && <span className="conds-reason">{row.reason}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
