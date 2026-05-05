/**
 * Analyst-style Markdown report from {@link EdgarDebtDocSearchResult} —
 * source-backed SEC Archives links only (deterministic index scan).
 */

import type { DebtDocumentTableRow, EdgarDebtDocSearchResult } from "@/lib/creditDocs/edgarDebtDocSearch/types";
import type { DebtDiscoverySaveResult } from "@/lib/creditDocs/saveDebtDiscoveryToSavedDocuments";

function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function linkMd(label: string, url: string): string {
  const u = url.trim();
  if (!u) return "—";
  const lab = mdCell(label || "link").slice(0, 120) || "document";
  return `[${lab}](${u})`;
}

function documentTitleFromRow(r: DebtDocumentTableRow): string {
  const bits = [r.exhibitNumber && r.exhibitNumber !== "—" ? `Ex-${r.exhibitNumber}` : "", r.documentType]
    .filter(Boolean)
    .join(" · ");
  const tail = r.instrumentOrFacilityName?.trim();
  if (bits && tail) return `${bits} — ${tail.slice(0, 180)}`;
  return tail || bits || r.directExhibitLink.split("/").pop() || "Document";
}

/** Build markdown aligned with credit-analyst debt-document index deliverables. */
export function formatDebtDocSearchAnalystMarkdown(
  result: EdgarDebtDocSearchResult,
  ticker: string,
  extras?: { savedDocuments?: DebtDiscoverySaveResult | null }
): string {
  const tk = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const { identity, executiveSummary, table, debtDocumentMap, missingChecklist, recommendedNextSearches, rawAudit } =
    result;

  const forms = [...new Set(table.map((r) => r.filingForm))];
  const facilityBuckets = Object.keys(debtDocumentMap).length;

  const lines: string[] = [];

  lines.push(`# SEC debt document index — ${tk}`);
  lines.push("");
  lines.push(`**Company:** ${identity.companyLegalName}  `);
  lines.push(`**CIK:** ${identity.cikPadded}  `);
  lines.push(`**Ticker:** ${identity.ticker ?? tk}  `);
  lines.push("");
  lines.push(
    "> **Method:** Programmatic EDGAR scan — submissions feed, per-filing index.json, exhibit descriptions, " +
      "and debt-keyword / EX-4 / EX-10 gates; sample text pulled only for classification when budget allows. " +
      "**All links point to sec.gov Archives.** This is not an LLM web-search pass (no hallucinated URLs).",
  );
  lines.push("");

  lines.push("## 1. EXECUTIVE SUMMARY");
  lines.push("");
  lines.push(`- **Debt-related exhibits/documents matched:** ${executiveSummary.debtRelatedDocumentsFound}`);
  lines.push(`- **Credit-agreement–style rows:** ${executiveSummary.creditAgreementsFound}`);
  lines.push(`- **Indenture / notes–style rows:** ${executiveSummary.indenturesNoteDocumentsFound}`);
  lines.push(`- **Amendment / waiver / consent–style rows:** ${executiveSummary.amendmentsFound}`);
  lines.push(`- **High-level buckets (heuristic):** ${facilityBuckets}`);
  lines.push(`- **Forms touched:** ${forms.slice(0, 22).join(", ")}${forms.length > 22 ? ", …" : ""}`);
  lines.push(
    `- **Coverage:** Filings scanned this run: **${rawAudit.filingsConsidered}** (cap applies); exhibits indexed: **${rawAudit.exhibitsIndexed}**; ` +
      `exhibits sampled for text classification: **${rawAudit.exhibitsDownloadedForClassification}**.`,
  );
  lines.push(
    `- **Structure:** ${facilityBuckets >= 4 ? "Appears **complex** (multiple buckets)." : "Appears relatively **focused** or sparse in matched exhibits."} ` +
      `${executiveSummary.materialMissingDocuments.length ? "**Possible gaps** — see section 4." : ""}`,
  );
  lines.push("");

  lines.push("## 2. DOCUMENT TABLE");
  lines.push("");
  lines.push(
    "| Security / Facility | Document Type | Document Title | Filing Date | Filing / Source | Direct Document Link | Filing Link | Notes |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");

  for (const r of table) {
    const filingSrc = mdCell(`${r.filingForm} · ${r.accessionNumber}`);
    const title = mdCell(documentTitleFromRow(r));
    lines.push(
      `| ${mdCell(r.instrumentOrFacilityName)} | ${mdCell(r.documentType)} | ${title} | ${mdCell(r.filingDate)} | ${filingSrc} | ` +
        `${linkMd("Direct exhibit", r.directExhibitLink)} | ${linkMd("Filing primary", r.filingLink)} | ${mdCell(r.notesWhyRelevant)} |`,
    );
  }

  lines.push("");

  lines.push("## 3. GROUPED BY DEBT INSTRUMENT / FACILITY");
  lines.push("");
  lines.push("*Heuristic buckets + rows ordered by filing date (newest first within bucket).*");
  lines.push("");

  const buckets = Object.entries(debtDocumentMap).sort(([a], [b]) => a.localeCompare(b));
  for (const [bucket, rows] of buckets) {
    lines.push(`### ${bucket}`);
    lines.push("");
    const subGroups = new Map<string, DebtDocumentTableRow[]>();
    for (const row of rows) {
      const key = row.instrumentOrFacilityName.trim().slice(0, 160) || "(unspecified facility)";
      if (!subGroups.has(key)) subGroups.set(key, []);
      subGroups.get(key)!.push(row);
    }
    for (const [fac, rs] of [...subGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`#### ${mdCell(fac)}`);
      lines.push("");
      for (const r of rs.sort((a, b) => (b.filingDate || "").localeCompare(a.filingDate || ""))) {
        lines.push(`- **${mdCell(r.documentType)}** (${r.filingForm}, ${r.filingDate}) — ${linkMd("exhibit", r.directExhibitLink)} · ${linkMd("filing", r.filingLink)}`);
        if (r.amendmentSequence && r.amendmentSequence !== "—") {
          lines.push(`  - Amendment chain hint: ${mdCell(r.amendmentSequence)}`);
        }
      }
      lines.push("");
    }
  }

  lines.push("## 4. IMPORTANT MISSING DOCUMENTS / FOLLOW-UPS");
  lines.push("");
  if (!missingChecklist.length && !executiveSummary.materialMissingDocuments.length) {
    lines.push("*No automated missing-items flagged — manual review still recommended for private-side docs.*");
  } else {
    for (const m of missingChecklist) {
      lines.push(`- **${mdCell(m.instrumentOrDescription)}** — ${mdCell(m.reason)}`);
    }
    for (const x of executiveSummary.materialMissingDocuments) {
      lines.push(`- ${mdCell(x)}`);
    }
  }
  lines.push("");
  for (const rec of recommendedNextSearches) {
    lines.push(`- ${mdCell(rec)}`);
  }
  lines.push("");

  lines.push("## 5. SOURCE NOTES");
  lines.push("");
  lines.push(
    "- **SEC submissions API** (`data.sec.gov/submissions/CIKxxxxxx.json`) — full recent + historical chunks where available.",
  );
  lines.push("- **Per-accession directory index** (`Archives/.../index.json`) — definitive exhibit filenames and URLs.");
  lines.push("- **Primary filing HTML** — exhibit tables parsed when present for descriptions / exhibit numbers.");
  lines.push("- **8-K items** — Item lines extracted when primary document loads for credit-related filings.");
  lines.push(
    `- **Run audit:** ${rawAudit.filingsConsidered} filings considered (after relevance filter + cap), ` +
      `${rawAudit.exhibitsIndexed} index rows seen, ${rawAudit.exhibitsDownloadedForClassification} exhibits text-sampled.`,
  );
  lines.push("");

  const sd = extras?.savedDocuments;
  if (sd) {
    lines.push("## 6. SAVED TO SAVED DOCUMENTS (INGESTION)");
    lines.push("");
    lines.push(
      `Binary exhibits were downloaded from SEC Archives and upserted into your ticker’s **Saved Documents** tab ` +
        `(Postgres). They are picked up automatically by Entity Mapper, LME Analysis, KPI commentary, Capital Structure ` +
        `Recommendation, Forensic, and other pipelines that ingest Saved Documents.`,
    );
    lines.push("");
    lines.push(
      `- **Download attempts (this run):** ${sd.attempted} · **Saved:** ${sd.saved.length} · **Failed:** ${sd.failed.length} · ` +
        `**Skipped (incorporated by reference):** ${sd.skippedIncorporatedByReference} · **Skipped (non-Archives URL):** ${sd.skippedNonArchivesUrl} · ` +
        `**Not attempted (cap):** ${sd.cappedOverMaxDownloads}`,
    );
    lines.push("");
    if (sd.saved.length) {
      lines.push("| Saved filename | Title | SEC exhibit URL | Bytes |");
      lines.push("| --- | --- | --- | --- |");
      for (const s of sd.saved) {
        lines.push(
          `| ${mdCell(s.filename)} | ${mdCell(s.title)} | ${linkMd("exhibit", s.url)} | ${mdCell(String(s.bytes))} |`,
        );
      }
      lines.push("");
    }
    if (sd.failed.length) {
      lines.push("### Download / save failures");
      lines.push("");
      for (const f of sd.failed.slice(0, 40)) {
        lines.push(`- ${linkMd("URL", f.url)} — ${mdCell(f.error)}`);
      }
      if (sd.failed.length > 40) {
        lines.push(`- *…and ${sd.failed.length - 40} more.*`);
      }
      lines.push("");
    }
  }

  lines.push(`*Generated ${new Date().toISOString()}.*`);

  return lines.join("\n");
}
