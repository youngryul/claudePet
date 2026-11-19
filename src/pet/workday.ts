/**
 * Work-day countdown for the pet's speech bubble. Pure functions, local time.
 *
 *   before work ─ start ─ morning ─ lunchStart ─ lunch ─ lunchEnd ─ afternoon ─ end ─ done
 */

/** One day's hours. "HH:MM", 24h, local time. */
export interface DayHours {
  workStart: string;
  lunchStart: string;
  lunchEnd: string;
  workEnd: string;
}

export interface WorkSchedule extends DayHours {
  enabled: boolean;
  /** 0 = Sunday ... 6 = Saturday. */
  workdays: number[];
  /** Use `days[d]` instead of the shared hours above, where set. */
  perDay: boolean;
  /** Per-weekday hours, keyed by day number ("0".."6" once stored as JSON). */
  days: Partial<Record<number, DayHours>>;
  /** Mix random cheer-up messages into the bubble. */
  cheers: boolean;
}

export const DEFAULT_SCHEDULE: WorkSchedule = {
  enabled: false,
  workStart: "09:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  workEnd: "18:00",
  workdays: [1, 2, 3, 4, 5],
  perDay: false,
  days: {},
  cheers: true,
};

const pickHours = ({ workStart, lunchStart, lunchEnd, workEnd }: DayHours): DayHours => ({ workStart, lunchStart, lunchEnd, workEnd });

/** The hours that apply on weekday `day`: its own when per-day is on, else the shared ones. */
export function hoursFor(s: WorkSchedule, day: number): DayHours {
  const own = s.perDay ? s.days?.[day] : undefined;
  return own ? pickHours(own) : pickHours(s);
}

export type WorkPhase =
  | { kind: "off" }
  | { kind: "beforeWork"; minutesLeft: number }
  | { kind: "morning"; minutesLeft: number }
  | { kind: "lunch"; minutesLeft: number }
  | { kind: "afternoon"; minutesLeft: number }
  | { kind: "done" };

/** Show the "until work" countdown only this close to the start. */
const BEFORE_WORK_WINDOW_MIN = 120;

export function parseHM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Minutes since midnight of each boundary, or null unless start < lunchStart <= lunchEnd < end. */
function boundaries(s: DayHours) {
  const start = parseHM(s.workStart);
  const lunchStart = parseHM(s.lunchStart);
  const lunchEnd = parseHM(s.lunchEnd);
  const end = parseHM(s.workEnd);
  if (start === null || lunchStart === null || lunchEnd === null || end === null) return null;
  return start < lunchStart && lunchStart <= lunchEnd && lunchEnd < end ? { start, lunchStart, lunchEnd, end } : null;
}

export const isValidHours = (h: DayHours): boolean => boundaries(h) !== null;

/** Every workday's hours are in order. */
export const isValidSchedule = (s: WorkSchedule): boolean =>
  s.perDay ? s.workdays.every((d) => isValidHours(hoursFor(s, d))) : isValidHours(s);

export function workPhase(s: WorkSchedule, now: Date): WorkPhase {
  const day = now.getDay();
  if (!s.enabled || !s.workdays.includes(day)) return { kind: "off" };
  const b = boundaries(hoursFor(s, day));
  if (!b) return { kind: "off" };
  const { start, lunchStart, lunchEnd, end } = b;
  // Round seconds up so "1 minute left" lasts until the minute actually ends.
  const t = now.getHours() * 60 + now.getMinutes() + (now.getSeconds() > 0 ? 1 / 60 : 0);
  const left = (until: number) => Math.max(1, Math.ceil(until - t));
  if (t < start) return start - t <= BEFORE_WORK_WINDOW_MIN ? { kind: "beforeWork", minutesLeft: left(start) } : { kind: "off" };
  if (t < lunchStart) return { kind: "morning", minutesLeft: left(lunchStart) };
  if (t < lunchEnd) return { kind: "lunch", minutesLeft: left(lunchEnd) };
  if (t < end) return { kind: "afternoon", minutesLeft: left(end) };
  return { kind: "done" };
}

/** Pick an index different from `previous` when there is a choice. */
export function pickIndex(length: number, previous: number | null, random = Math.random): number {
  if (length <= 1) return 0;
  const i = Math.floor(random() * (length - 1));
  return previous !== null && i >= previous ? i + 1 : i;
}

/** How long the cheer-up pet stays out at each moment. */
export const CHEER_MINUTES = 1;
/** Offsets (minutes) from the day's boundaries at which the pet cheers. */
const CHEER_AT = { afterStart: 10, beforeLunch: 10, beforeEnd: 10 } as const;

/**
 * Cheer-up moments on a workday: 10 min after work starts, 10 min before lunch and
 * 10 min before work ends. True for `CHEER_MINUTES` from each moment.
 */
export function isCheerTime(s: WorkSchedule, now: Date): boolean {
  const day = now.getDay();
  if (!s.enabled || !s.workdays.includes(day)) return false;
  const b = boundaries(hoursFor(s, day));
  if (!b) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return [b.start + CHEER_AT.afterStart, b.lunchStart - CHEER_AT.beforeLunch, b.end - CHEER_AT.beforeEnd].some(
    (m) => t >= m && t < m + CHEER_MINUTES,
  );
}
