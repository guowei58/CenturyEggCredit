/**
 * Extract XBRL workbooks for a ticker from the DB to a temp folder.
 * Usage: node scripts/extract-xbrl-files.mjs FICO
 */
import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import fs from "fs/promises";
import path from "path";
import os from "os";

const ticker = (process.argv[2] ?? "").toUpperCase();
if (!ticker) { console.error("Usage: node extract-xbrl-files.mjs <TICKER>"); process.exit(1); }

const prisma = new PrismaClient();
const RE = /SEC-XBRL-financials_as-presented/i;

try {
  const rows = await prisma.userSavedDocument.findMany({
    where: { ticker, filename: { contains: "SEC-XBRL" } },
    select: { filename: true, body: true, userId: true },
  });

  const matches = rows.filter(r => RE.test(r.filename));
  if (!matches.length) { console.error(`No XBRL files for ${ticker}`); process.exit(1); }

  const dir = path.join(os.tmpdir(), `xbrl-diag-${ticker}`);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(dir, { recursive: true });

  for (const r of matches) {
    await fs.writeFile(path.join(dir, r.filename), Buffer.from(r.body));
    console.log(`  wrote ${r.filename} (${r.body.length} bytes)`);
  }

  console.log(`\n${matches.length} files extracted to:\n${dir}`);
} finally {
  await prisma.$disconnect();
}
