/** Matches `pg` / Prisma errors when Render or the network drops an idle or in-use connection. */
const TRANSIENT_PG =
  /Connection terminated|connection terminated|ECONNRESET|EPIPE|ETIMEDOUT|connection timeout|server closed the connection|Connection closed/i;

/**
 * Postgres startup / recovery (e.g. Render waking a sleeping DB, or crash recovery).
 * Error code 57P03 — "the database system is not yet accepting connections".
 */
const TRANSIENT_STARTUP_RECOVERY =
  /57P03|not yet accepting connections|recovery state has not been yet reached|Consistent recovery state|database system is starting up|the database system is in recovery mode/i;

/** Thrown when storage quota blocks a write — must not trigger PG retries. */
export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED" as const;
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

/** Flatten Prisma `DriverAdapterError`, nested `cause`, and plain objects for matching. */
function collectPgErrorText(e: unknown): string {
  const parts: string[] = [];
  const walk = (x: unknown, depth: number): void => {
    if (depth > 8 || x == null) return;
    if (typeof x === "string") {
      parts.push(x);
      return;
    }
    if (typeof x === "number" || typeof x === "boolean") {
      parts.push(String(x));
      return;
    }
    if (x instanceof Error) {
      parts.push(x.name, x.message);
      if ("cause" in x && (x as Error & { cause?: unknown }).cause !== undefined) {
        walk((x as Error & { cause?: unknown }).cause, depth + 1);
      }
      return;
    }
    if (typeof x === "object") {
      const o = x as Record<string, unknown>;
      for (const k of [
        "message",
        "originalMessage",
        "detail",
        "hint",
        "code",
        "originalCode",
        "kind",
        "name",
      ]) {
        const v = o[k];
        if (typeof v === "string") parts.push(v);
      }
      if (o.cause !== undefined) walk(o.cause, depth + 1);
    }
  };
  walk(e, 0);
  return parts.join(" \n ");
}

export function isTransientPgConnectionError(e: unknown): boolean {
  if (e instanceof QuotaExceededError) return false;
  const t = collectPgErrorText(e);
  if (TRANSIENT_PG.test(t)) return true;
  if (TRANSIENT_STARTUP_RECOVERY.test(t)) return true;
  return false;
}

function isStartupOrRecoveryError(e: unknown): boolean {
  const t = collectPgErrorText(e);
  return TRANSIENT_STARTUP_RECOVERY.test(t);
}

/**
 * Retry only for obvious transient TCP/pg failures — not unique violations or query bugs.
 * Does not reset the pool (safe under concurrent load).
 *
 * Startup/recovery (57P03, "not yet accepting connections") uses longer backoff — common when
 * a hosted DB is waking from sleep.
 */
export async function withTransientPgRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { retries?: number; baseDelayMs?: number }
): Promise<T> {
  /** Extra attempts after the first try (default 4 → 5 attempts total). */
  const extra = opts?.retries ?? 4;
  const maxAttempts = extra + 1;
  const baseDelayMs = opts?.baseDelayMs ?? 400;
  let last: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isTransientPgConnectionError(e) || attempt === maxAttempts - 1) throw e;
      const recovery = isStartupOrRecoveryError(e);
      const mult = recovery ? 4 : 1;
      const cap = recovery ? 12_000 : 4_000;
      const raw = baseDelayMs * mult * 2 ** attempt + Math.floor(Math.random() * 150);
      const d = Math.min(cap, raw);
      if (process.env.NODE_ENV === "development") {
        const tag = recovery ? " [DB starting/recovery — longer wait]" : "";
        console.warn(
          `[pg retry] ${label} attempt ${attempt + 1}/${maxAttempts}${tag}:`,
          e instanceof Error ? e.message : e
        );
      }
      await new Promise((r) => setTimeout(r, d));
    }
  }
  throw last;
}
