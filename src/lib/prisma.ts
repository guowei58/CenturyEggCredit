import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

function parsePoolInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Hosted Postgres (e.g. Render) often closes idle TLS sockets; `pg` may hand out a dead client.
 * Rotating clients after N uses avoids extremely long-lived sockets (see `maxUses` below).
 * Do **not** call `pool.end()` from `pool.on("error")` — that races with in-flight Prisma queries
 * and produces "Cannot use a pool after calling end on the pool".
 */
function createPgPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const max = Math.min(40, Math.max(2, parsePoolInt(process.env.PG_POOL_MAX, 10)));
  /** Recycle a pooled client after this many checkouts (default 35). Helps with flaky remote Postgres. */
  const maxUses = Math.min(5000, Math.max(10, parsePoolInt(process.env.PG_POOL_MAX_USES, 35)));

  const pool = new Pool({
    connectionString,
    max,
    maxUses,
    idleTimeoutMillis: parsePoolInt(process.env.PG_POOL_IDLE_MS, 30_000),
    connectionTimeoutMillis: parsePoolInt(process.env.PG_POOL_CONNECTION_TIMEOUT_MS, 15_000),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  let lastPoolIdleErrLog = 0;
  pool.on("error", (err) => {
    const now = Date.now();
    const verbose = process.env.PG_POOL_LOG_ALL_IDLE_ERRORS === "1";
    if (!verbose && now - lastPoolIdleErrLog < 20_000) return;
    lastPoolIdleErrLog = now;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      "[pg pool] idle connection dropped by network/DB (pool replaces bad clients; set PG_POOL_LOG_ALL_IDLE_ERRORS=1 for every event):",
      msg
    );
  });

  return pool;
}

function createPrismaClient(): PrismaClient {
  const pool = globalForPrisma.pgPool ?? createPgPool();
  globalForPrisma.pgPool = pool;
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

/**
 * Reuse one client per process, but drop a stale singleton after `prisma generate`
 * adds models. Otherwise `globalThis.prisma` can hold a pre-regeneration client whose
 * delegates (e.g. `conversationMember`) are missing → undefined.findMany at runtime.
 */
function getPrisma(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (
    existing &&
    typeof existing.conversationMember?.findMany === "function" &&
    typeof existing.eggHocMessage?.findMany === "function" &&
    typeof existing.userDailyNewsBatch?.upsert === "function" &&
    typeof existing.publicRecordsProfile?.findUnique === "function"
  ) {
    return existing;
  }
  const client = createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

/**
 * Lazy singleton: do not connect at import time. `next build` loads API route modules
 * that import `prisma`; without DATABASE_URL in the Docker build, eager init would throw.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getPrisma(), prop, receiver);
  },
});
