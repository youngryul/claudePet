import { currentDict } from "@/i18n";

export const localDate = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function formatDuration(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return currentDict().format.duration(h, m);
}

export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export const formatInt = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString(currentDict().locale);

export function formatRelative(ts: number | null, now = Date.now()): string {
  const f = currentDict().format;
  if (ts === null) return f.never;
  const s = Math.round((now - ts) / 1000);
  if (s < 5) return f.justNow;
  if (s < 60) return f.secondsAgo(s);
  if (s < 3600) return f.minutesAgo(Math.floor(s / 60));
  return f.hoursAgo(Math.floor(s / 3600));
}

export function formatResetIn(ts: number | null, now = Date.now()): string | null {
  if (ts === null) return null;
  const min = Math.max(0, Math.round((ts - now) / 60_000));
  const f = currentDict().format;
  if (min < 60) return f.resetsInM(min);
  const h = Math.floor(min / 60);
  if (h < 48) return f.resetsInHM(h, min % 60);
  return f.resetsInD(Math.floor(h / 24));
}
