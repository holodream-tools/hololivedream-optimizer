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
