/**
 * Render the structured skill records as the sentences a player reads in game.
 *
 * The bundle carries fields, not prose, so every string is built here. Anything
 * the engine does not model returns null rather than a guess.
 */
import type { OutfitPayload, SkillJson } from '../engine/types';
import { branchLabel } from './members';

const STAT_LABEL: Record<string, string> = {
  all: '全能力', performance: '表現力', technique: '技巧', sense: '品味',
  score_support: 'Score Support',
};
const ATTRIBUTE_LABEL: Record<string, string> = { cute: 'Cute', happy: 'Happy', pure: 'Pure' };

function attribute(value: unknown): string {
  const key = String(value ?? '').toLowerCase();
  return ATTRIBUTE_LABEL[key] ?? String(value ?? '');
}

function conditionText(condition: unknown): string | null {
  if (!condition || typeof condition !== 'object') return null;
  const row = condition as { type?: string; type_name?: string; group?: string; min_count?: number };
  if (row.type === 'type_count') return `隊上 ${attribute(row.type_name)} ${row.min_count ?? 0} 人以上時`;
  if (row.type === 'group_count') return `隊上 ${branchLabel(String(row.group))} ${row.min_count ?? 0} 人以上時`;
  return null;
}

function targetText(target: unknown): string {
  if (target === 'self') return '自身';
  if (target && typeof target === 'object') {
    const row = target as { type_match?: string; group?: string; count?: number };
    const count = row.count ?? 0;
    if (row.type_match) return `${attribute(row.type_match)} 屬性中能力最高的 ${count} 人`;
    if (row.group) return `${branchLabel(String(row.group))} 中能力最高的 ${count} 人`;
  }
  return '——';
}

export function passiveText(skill: SkillJson | null | undefined): string | null {
  if (!skill?.effect_type) return null;
  const effect = String(skill.effect_type);
  const value = Number(skill.value ?? 0);
  const target = targetText(skill.target);
  const when = conditionText(skill.condition);
  const prefix = when ? `${when}，` : '';
  if (effect === 'self_all_param_conditional' || effect === 'type_all_param') {
    return `${prefix}${target}的全能力 +${value}%`;
  }
  if (effect.endsWith('score_support') || effect.endsWith('score_support_conditional')) {
    return `${prefix}${target}的 Score Support +${value}`;
  }
  const stat = STAT_LABEL[String(skill.stat ?? '')] ?? String(skill.stat ?? '能力');
  return `${prefix}${target}的 ${stat} +${value}%`;
}

export function activeText(skill: SkillJson | null | undefined): string | null {
  if (!skill || skill.interval == null) return null;
  const interval = Number(skill.interval);
  const duration = Number(skill.duration ?? 0);
  const chance = Number(skill.activation_probability_permil ?? 0) / 10;
  const scoreUp = Number(skill.score_up ?? 0);
  const base = `每 ${interval} 秒以 ${chance}% 機率發動，持續 ${duration} 秒內分數 +${scoreUp}%`;
  if (skill.conditional_score_up == null) return base;
  const condition = String(skill.condition ?? '');
  const boosted = Number(skill.conditional_score_up);
  if (condition.endsWith('_2')) {
    return `${base}（隊上 ${attribute(condition.slice(0, -2))} 2 人以上時改為 +${boosted}%）`;
  }
  if (condition.startsWith('combo_')) {
    return `${base}（Combo ${condition.split('_').pop()} 以上時改為 +${boosted}%）`;
  }
  if (condition.startsWith('life_')) {
    return `${base}（Life ${condition.split('_').pop()} 以上時改為 +${boosted}%）`;
  }
  return base;
}

export function specialText(skill: SkillJson | null | undefined): string | null {
  if (!skill || skill.duration == null) return null;
  const duration = Number(skill.duration);
  const support = Number(skill.score_support ?? 0);
  const rate = Number(skill.skill_rate_up ?? 0);
  const parts = [`持續 ${duration} 秒`];
  if (support) parts.push(`Score Support +${support}`);
  if (rate) parts.push(`Active 發動率 +${rate}%`);
  return parts.join('、');
}

export function outfitText(payload: OutfitPayload | null | undefined): string | null {
  if (!payload) return null;
  const when = conditionText(payload.condition);
  const prefix = when ? `${when}，` : '';
  const effects = (payload.effects ?? []).map((effect) => {
    const stat = STAT_LABEL[String(effect.stat ?? '')] ?? String(effect.stat ?? '');
    const unit = effect.stat === 'score_support' ? '' : '%';
    return `全員 ${stat} +${effect.value ?? 0}${unit}`;
  });
  return effects.length ? `${prefix}${effects.join('、')}` : null;
}
