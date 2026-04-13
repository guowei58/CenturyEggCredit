/**
 * Calendar math for America/New_York (daily news batch keys & rolling windows).
 */

const NY = "America/New_York";

export function formatNyDateKey(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NY,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

export function nowInNy(): Date {
  return new Date();
}

/** Last N calendar date keys ending today (NY), newest first. */
export function lastNDateKeysInNy(n: number, from: Date = new Date()): string[] {
  const keys: string[] = [];
  const cur = new Date(from.getTime());
  for (let i = 0; i < n; i++) {
    const key = formatNyDateKey(cur);
    keys.push(key);
    cur.setUTCDate(cur.getUTCDate() - 1);
  }
  return keys;
}

/** Parse YYYY-MM-DD as UTC noon to avoid DST flip issues when comparing. */
function parseIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
}

/**
 * True if `isoDate` (filing or article date) is within the rolling window
 * ending `windowEnd` (typically "now" when generating).
 */
export function isWithinRollingHours(isoDate: string, windowEnd: Date, hours: number): boolean {
  const d = parseIsoDate(isoDate.slice(0, 10));
  if (!d || Number.isNaN(d.getTime())) return false;
  const ms = hours * 60 * 60 * 1000;
  return d.getTime() >= windowEnd.getTime() - ms && d.getTime() <= windowEnd.getTime();
}

/** Hour (0–23) in America/New_York for the given instant. */
export function getNyHour(d: Date): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: NY, hour: "numeric", hour12: false }).format(d);
  return Number.parseInt(h, 10) || 0;
}

export function getNyMinute(d: Date): number {
  const m = new Intl.DateTimeFormat("en-US", { timeZone: NY, minute: "numeric" }).format(d);
  return Number.parseInt(m, 10) || 0;
}
