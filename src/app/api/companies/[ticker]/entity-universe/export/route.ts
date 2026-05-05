import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { relevanceLabel } from "@/lib/scoreEntityRelevance";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  let sections: Record<string, boolean> = {};
  try {
    const b = await request.json();
    if (b && typeof b === "object" && b.sections) sections = b.sections as Record<string, boolean>;
  } catch {
    sections = {};
  }

  const all = Object.keys(sections).length === 0;
  const want = (k: string) => all || sections[k];

  const ex = want("exhibit21")
    ? await prisma.exhibit21Subsidiary.findMany({ where: { userId, ticker } })
    : [];
  const cd = want("credit_docs")
    ? await prisma.creditDocumentEntity.findMany({ where: { userId, ticker } })
    : [];
  const ucc = want("ucc") ? await prisma.uccDebtorCandidate.findMany({ where: { userId, ticker } }) : [];
  const sos = want("sos") ? await prisma.sosNameFamilyCandidate.findMany({ where: { userId, ticker } }) : [];
  const addr = want("addresses")
    ? await prisma.addressClusterCandidate.findMany({ where: { userId, ticker } })
    : [];
  const master = want("master_universe") || want("issues_memo")
    ? await prisma.entityUniverseItem.findMany({
        where: { userId, ticker },
        orderBy: { relevanceScore: "desc" },
      })
    : [];
  const issues = want("issues_memo") || want("master_universe")
    ? await prisma.entityUniverseIssue.findMany({ where: { userId, ticker } })
    : [];

  const lines: string[] = [];
  lines.push(`# Entity universe diligence memo (${ticker})`);
  lines.push("");
  lines.push(
    "Executive summary — this memo consolidates Exhibit 21 names, manually captured credit-document parties, UCC candidates, SOS name-family searches, and address clustering. Items are hypotheses for review unless confirmed."
  );
  lines.push("");

  lines.push(`## Highest relevance entities not listed in Exhibit 21`);
  const flagged = master
    .filter((m) => !m.listedInExhibit21 && m.relevanceScore >= 55)
    .slice(0, 25)
    .map((m) => `- **${m.entityName}** — relevance score ${m.relevanceScore} (${relevanceLabel(m.relevanceScore)}); review status \`${m.reviewStatus}\``);
  lines.push(flagged.length ? flagged.join("\n") : "(none over threshold)");

  lines.push("");
  lines.push(`## Issues / follow-up flags`);
  if (issues.length === 0) lines.push("(no generated issues)");
  else
    for (const iss of issues) {
      lines.push(`- **${iss.issueTitle}** [\`${iss.severity}\`] — ${iss.issueDescription.replace(/\*\*/g, "")}`);
    }

  lines.push("");
  lines.push(`## Appendix — JSON payloads`);
  const payload = {
    exhibit21Subsidiaries: ex,
    creditDocumentEntities: cd,
    uccDebtorCandidates: ucc,
    sosNameFamilyCandidates: sos,
    addressClusterCandidates: addr,
    entityUniverseItems: master,
    entityUniverseIssues: issues,
    generatedAtIso: new Date().toISOString(),
  };

  return NextResponse.json({
    markdown: lines.join("\n"),
    bundle: payload,
  });
}
