/** Growth rules. Pure functions so they are easy to tune and test. */

export const XP_RULES = {
  perCodingMinute: 1,
  perLinesAdded: 1 / 10,
  perLinesRemoved: 1 / 20,
  perTurn: 2,
  perSessionEnd: 15,
  perOutputTokens: 1 / 5_000,
} as const;

export interface XpInput {
  codingMs: number;
  linesAdded: number;
  linesRemoved: number;
  turns: number;
  sessionsEnded: number;
  outputTokens: number;
}

/** Fractional XP; the tracker carries the remainder between flushes. */
export function xpFor(d: XpInput): number {
  return (
    (d.codingMs / 60_000) * XP_RULES.perCodingMinute +
    d.linesAdded * XP_RULES.perLinesAdded +
    d.linesRemoved * XP_RULES.perLinesRemoved +
    d.turns * XP_RULES.perTurn +
    d.sessionsEnded * XP_RULES.perSessionEnd +
    d.outputTokens * XP_RULES.perOutputTokens
  );
}

/** XP needed to go from `level` to `level + 1`. */
export const xpForNextLevel = (level: number) => 80 + 35 * level;

export interface LevelInfo {
  level: number;
  /** XP accumulated inside the current level. */
  intoLevel: number;
  /** XP needed to finish the current level. */
  needed: number;
  progress: number;
}

export function levelFromXp(totalXp: number): LevelInfo {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (remaining >= xpForNextLevel(level)) {
    remaining -= xpForNextLevel(level);
    level += 1;
  }
  const needed = xpForNextLevel(level);
  return { level, intoLevel: remaining, needed, progress: remaining / needed };
}
