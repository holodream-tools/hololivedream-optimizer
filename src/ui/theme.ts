/**
 * Card attribute identity.
 *
 * The three attributes are the primary way players sort cards at a glance, so
 * they get the colour, and everything else in the UI stays neutral. Values are
 * chosen to stay legible on both the light and dark ground.
 */
export const ATTRIBUTES = ['cute', 'happy', 'pure'] as const;
export type Attribute = (typeof ATTRIBUTES)[number];

export interface AttributeStyle { label: string; accent: string; soft: string; line: string }

export const ATTRIBUTE_STYLES: Record<string, AttributeStyle> = {
  cute:  { label: 'Cute',  accent: 'var(--cute)',  soft: 'var(--cute-soft)',  line: 'var(--cute-line)' },
  happy: { label: 'Happy', accent: 'var(--happy)', soft: 'var(--happy-soft)', line: 'var(--happy-line)' },
  pure:  { label: 'Pure',  accent: 'var(--pure)',  soft: 'var(--pure-soft)',  line: 'var(--pure-line)' },
};

export function attributeStyle(type: string): AttributeStyle {
  return ATTRIBUTE_STYLES[type.toLowerCase()] ?? {
    label: type || '—', accent: 'var(--ink-3)', soft: 'var(--surface-2)', line: 'var(--line)',
  };
}


/**
 * Chart difficulty identity.
 *
 * Deliberately a different hue family from the card attributes: the two never
 * appear together, but a player who has learned "amber = Happy" should not read
 * an amber difficulty badge as an attribute.
 */
export const DIFFICULTIES = ['Easy', 'Normal', 'Hard', 'Expert'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_STYLES: Record<string, AttributeStyle> = {
  Easy:   { label: 'Easy',   accent: 'var(--easy)',   soft: 'var(--easy-soft)',   line: 'var(--easy-line)' },
  Normal: { label: 'Normal', accent: 'var(--normal)', soft: 'var(--normal-soft)', line: 'var(--normal-line)' },
  Hard:   { label: 'Hard',   accent: 'var(--hard)',   soft: 'var(--hard-soft)',   line: 'var(--hard-line)' },
  Expert: { label: 'Expert', accent: 'var(--expert)', soft: 'var(--expert-soft)', line: 'var(--expert-line)' },
};

export function difficultyStyle(value: string | undefined): AttributeStyle {
  return DIFFICULTY_STYLES[value ?? ''] ?? {
    label: value || '—', accent: 'var(--ink-3)', soft: 'var(--surface-2)', line: 'var(--line)',
  };
}

/** Seconds as m:ss, for song lengths. */
export function duration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '—';
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
