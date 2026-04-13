/**
 * Extract XBRL workbooks for a ticker from the DB to a temp folder.
 * Usage: npx tsx scripts/extract-xbrl-files.ts FICO
 */
import { prisma } from "../src/lib/prisma";
import fs from "fs/promises";
import path from "path";
import os from "os";

const ticker = (process.argv[2] ?? "").toUpperCase();
if (!ticker) { console.error("Usage: npx tsx scripts/extract-xbrl-files.ts <TICKER>"); process.exit(1); }

const RE = /SEC-XBRL-financials_as-presented/i;

async function main() {
  const rows = await prisma.userSavedDocument.findMany({
    where: { ticker, filename: { contains: "SEC-XBRL" } },
    select: { filename: true, body: true },
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
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
