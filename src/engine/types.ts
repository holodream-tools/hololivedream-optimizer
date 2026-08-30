/** Shapes of the exported data bundles and of the engine's working values. */

export interface SkillJson { [key: string]: unknown }

export interface BloomJson {
  performance: number;
  technique: number;
  sense: number;
  support: SkillJson | null;
  active: SkillJson | null;
  special: SkillJson | null;
}

export interface CardJson {
  id: string; talent: string; name: string; title: string;
  type: string; generation: string;
  maxBloom: number;
  blooms: Record<string, BloomJson>;
  /**
   * The game's own card number, from upstream's `holodori_id`. Its blocks carry
   * the roster order -- 0xxx and 6xxx are JP, 3xxx ID, 4xxx EN -- which is the
   * only ordering signal in the data. Absent from the build-time snapshot,
   * whose source does not keep the field, so every reader needs a fallback.
   */
  cardNumber?: number;
}

export interface LeaderJson {
  id: string; talent: string; name: string;
  maxBloom: number;
  outfits: Record<string, OutfitPayload | null>;
}

export interface OutfitEffect { stat?: string; target?: string; value?: number }
export interface OutfitCondition { type?: string; type_name?: string; group?: string; min_count?: number }
export interface OutfitPayload { condition?: OutfitCondition | null; effects?: OutfitEffect[] }

export interface CardBundle { cards: CardJson[]; leaders: LeaderJson[] }

/** One card's skill data pre-resolved at a chosen Bloom. Mirrors precompute.CardFacts. */
export interface CardFacts {
  id: string;
  talent: string;
  performance: number;
  technique: number;
  sense: number;
  total: number;
  type: string;           // already lowercased
  generation: string;
  /**
   * A second group this member counts as, for the handful (currently one:
   * Shirakami Fubuki, also 1期生) the upstream schema's one-group-per-card
   * field cannot express. See precompute.secondaryGenerationOf.
   */
  secondaryGeneration: string | null;
  passiveEffect: string | null;
  passiveValue: number;
  passiveTarget: unknown;
  passiveStat: string | null;
  passiveCondition: OutfitCondition | null;
  activePresent: boolean;
  activeProbability: number;
  /**
   * Activation Rate Up already standing from this member's holomem Board, in
   * percentage points. Zero everywhere the player's board is not modelled; the
   * frequency-node recommendation sets it, because a board complete enough to
   * be choosing between those nodes is also carrying every Activation Rate node
   * on the way to them.
   *
   * Summed with the Special windows' Rate Up before a single multiplication,
   * which is the published rule for stacking activation-rate effects.
   */
  boardActivationRate: number;
  activeInterval: number;
  activeDuration: number;
  activeScoreUp: number;
  activeCondition: unknown;
  activeConditionalScoreUp: number | null;
  specialSupportAverage: number;
  specialSarAverage: number;
  specialDuration: number;
  specialScoreSupport: number;
  specialSkillRateUp: number;
  specialRateCondition: unknown;
}

/** Leader outfits keyed back to their original index, so tie-breaks survive. */
export interface OutfitTable {
  signatureOf: Int32Array;              // leader index -> payload id
  payloads: (OutfitPayload | null)[];   // payload id -> outfit payload
  count: number;                        // number of leaders, not of payloads
}
