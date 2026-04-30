import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buildPublicRecordsProfileFromSec } from "@/lib/buildPublicRecordsProfileFromSec";
import { mergePublicRecordsSecPrefill } from "@/lib/mergePublicRecordsSecPrefill";
import {
  SEC_SAVED_DOC_EXHIBIT21_BASE,
  SEC_SAVED_DOC_PRIMARY_BASE,
  upsertDocumentFromUrl,
} from "@/lib/saved-documents";
import {
  clampExhibit21SnapshotForPersist,
  clampSubsidiaryDomicileList,
  clampSubsidiaryNameList,
  publicRecordsProfileSaveErrorHint,
} from "@/lib/publicRecordsProfilePersistLimits";

export const dynamic = "force-dynamic";

/**
 * Fetch SEC submissions + latest 10-K (HQ hints) + Exhibit 21 subsidiary names when available, and merge into the saved public-records profile (persist).
 * Body (optional): `{ "refresh": true }` — replace subsidiary/name lists from SEC instead of merging with existing rows; also re-save primary + Exhibit 21 into Saved Documents.
 */
export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  let refresh = false;
  try {
    const text = await request.text();
    if (text.trim()) {
      const j = JSON.parse(text) as { refresh?: unknown };
      refresh = j.refresh === true;
    }
  } catch {
    refresh = false;
  }

  try {
    const built = await buildPublicRecordsProfileFromSec(ticker, userId);
    if (!built.ok) {
      return NextResponse.json({ error: built.message }, { status: 422 });
    }

    const { prefill } = built;

    let existing;
    try {
      existing = await prisma.publicRecordsProfile.findUnique({
        where: { userId_ticker: { userId, ticker } },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Database error";
      console.error("[ingest-10k] findUnique", e);
      if (/subsidiary_domiciles|column|does not exist/i.test(msg)) {
        return NextResponse.json(
          {
            error:
              "Database is missing a required column (e.g. subsidiary_domiciles). Run `npx prisma migrate deploy` and restart the app.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: `Profile load failed: ${msg}` }, { status: 500 });
    }

    const merged = mergePublicRecordsSecPrefill(
      {
        companyName: existing?.companyName ?? null,
        legalNames: existing?.legalNames ?? [],
        formerNames: existing?.formerNames ?? [],
        subsidiaryNames: existing?.subsidiaryNames ?? [],
        subsidiaryDomiciles: existing?.subsidiaryDomiciles ?? [],
        subsidiaryExhibit21Snapshot:
          existing?.subsidiaryExhibit21Snapshot === undefined || existing?.subsidiaryExhibit21Snapshot === null
            ? null
            : existing.subsidiaryExhibit21Snapshot,
        issuerNames: existing?.issuerNames ?? [],
        cik: existing?.cik ?? null,
        irsEmployerIdentificationNumber: existing?.irsEmployerIdentificationNumber ?? null,
        fiscalYearEnd: existing?.fiscalYearEnd ?? null,
        hqState: existing?.hqState ?? null,
        hqCity: existing?.hqCity ?? null,
        hqCounty: existing?.hqCounty ?? null,
        principalExecutiveOfficeAddress: existing?.principalExecutiveOfficeAddress ?? null,
        stateOfIncorporation: existing?.stateOfIncorporation ?? null,
        notes: existing?.notes ?? null,
      },
      prefill,
      { secIngest: true, replaceListsFromSec: refresh }
    );

    const cappedNames = clampSubsidiaryNameList(merged.subsidiaryNames ?? []);
    const cappedDoms = clampSubsidiaryDomicileList(merged.subsidiaryDomiciles ?? []).slice(0, cappedNames.length);
    const cappedSnapshot = clampExhibit21SnapshotForPersist(
      merged.subsidiaryExhibit21Snapshot == null ? null : merged.subsidiaryExhibit21Snapshot
    );
    const snapshotJson: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      cappedSnapshot === null ? Prisma.JsonNull : (cappedSnapshot as unknown as Prisma.InputJsonValue);

    let profile;
    try {
      profile = await prisma.publicRecordsProfile.upsert({
        where: { userId_ticker: { userId, ticker } },
        create: {
          userId,
          ticker,
          companyName: merged.companyName ?? null,
          legalNames: merged.legalNames ?? [],
          formerNames: merged.formerNames ?? [],
          dbaNames: [],
          subsidiaryNames: cappedNames,
          subsidiaryDomiciles: cappedDoms,
          subsidiaryExhibit21Snapshot: snapshotJson,
          borrowerNames: [],
          guarantorNames: [],
          issuerNames: merged.issuerNames ?? [],
          restrictedSubsidiaryNames: [],
          unrestrictedSubsidiaryNames: [],
          parentCompanyNames: [],
          operatingCompanyNames: [],
          hqState: merged.hqState ?? null,
          hqCounty: merged.hqCounty ?? null,
          hqCity: merged.hqCity ?? null,
          principalExecutiveOfficeAddress: merged.principalExecutiveOfficeAddress ?? null,
          stateOfIncorporation: merged.stateOfIncorporation ?? null,
          cik: merged.cik ?? null,
          irsEmployerIdentificationNumber: merged.irsEmployerIdentificationNumber ?? null,
          fiscalYearEnd: merged.fiscalYearEnd ?? null,
          majorFacilityLocations: Prisma.JsonNull,
          knownPropertyLocations: Prisma.JsonNull,
          knownPermitJurisdictions: Prisma.JsonNull,
          knownRegulatoryJurisdictions: Prisma.JsonNull,
          notes: merged.notes ?? null,
        },
        update: {
          companyName: merged.companyName ?? undefined,
          legalNames: merged.legalNames ?? [],
          formerNames: merged.formerNames ?? [],
          subsidiaryNames: cappedNames,
          subsidiaryDomiciles: cappedDoms,
          subsidiaryExhibit21Snapshot: snapshotJson,
          issuerNames: merged.issuerNames ?? [],
          hqState: merged.hqState ?? undefined,
          hqCounty: merged.hqCounty ?? undefined,
          hqCity: merged.hqCity ?? undefined,
          principalExecutiveOfficeAddress: merged.principalExecutiveOfficeAddress ?? undefined,
          stateOfIncorporation: merged.stateOfIncorporation ?? undefined,
          cik: merged.cik ?? undefined,
          irsEmployerIdentificationNumber: merged.irsEmployerIdentificationNumber ?? undefined,
          fiscalYearEnd: merged.fiscalYearEnd ?? undefined,
          notes: merged.notes ?? undefined,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Database error";
      console.error("[ingest-10k] upsert", e);
      if (/subsidiary_domiciles|column|does not exist/i.test(msg)) {
        return NextResponse.json(
          {
            error:
              "Database is missing a required column (e.g. subsidiary_domiciles). Run `npx prisma migrate deploy` and restart the app.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: publicRecordsProfileSaveErrorHint(msg) }, { status: 500 });
    }

    const savedDocs: { primary?: "ok" | "skipped" | "error"; exhibit21?: "ok" | "skipped" | "error"; errors?: string[] } =
      {};
    const errs: string[] = [];
    const filing = prefill.filing;
    if (filing?.docUrl?.trim()) {
      const r = await upsertDocumentFromUrl(userId, ticker, filing.docUrl.trim(), SEC_SAVED_DOC_PRIMARY_BASE);
      if (r.ok) savedDocs.primary = "ok";
      else {
        savedDocs.primary = "error";
        errs.push(`Primary annual filing: ${r.error}`);
      }
    } else {
      savedDocs.primary = "skipped";
    }
    const ex = filing?.exhibit21DocUrl?.trim();
    if (ex && (!filing?.docUrl?.trim() || ex !== filing.docUrl.trim())) {
      const r21 = await upsertDocumentFromUrl(userId, ticker, ex, SEC_SAVED_DOC_EXHIBIT21_BASE);
      if (r21.ok) savedDocs.exhibit21 = "ok";
      else {
        savedDocs.exhibit21 = "error";
        errs.push(`Exhibit 21: ${r21.error}`);
      }
    } else if (ex && filing?.docUrl?.trim() && ex === filing.docUrl.trim()) {
      savedDocs.exhibit21 = "skipped";
    } else {
      savedDocs.exhibit21 = "skipped";
    }
    if (errs.length) savedDocs.errors = errs;

    return NextResponse.json({
      profile,
      prefill,
      refresh,
      savedDocuments: savedDocs,
      disclaimer:
        "Values merged from SEC submissions JSON, latest 10-K text extraction, and Exhibit 21 (when listed in the filing index). Edit and verify before relying on search coverage.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingest-10k] error", e);
    return NextResponse.json({ error: `Ingest failed: ${msg}` }, { status: 500 });
  }
}
