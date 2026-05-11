import { NextResponse } from "next/server";
import { downloadFfiecBulkFile } from "@/lib/regulatory/ffiecCdr";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function isProductId(value: string): value is "ReportingSeriesSinglePeriod" | "ReportingSeriesSubsetSchedulesFourPeriods" {
  return value === "ReportingSeriesSinglePeriod" || value === "ReportingSeriesSubsetSchedulesFourPeriods";
}

function isFormat(value: string): value is "tsv" | "xbrl" {
  return value === "tsv" || value === "xbrl";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const product = url.searchParams.get("product")?.trim() || "";
  const period = url.searchParams.get("period")?.trim() || "";
  const format = url.searchParams.get("format")?.trim() || "";

  if (!isProductId(product)) {
    return NextResponse.json({ ok: false, error: "Invalid FFIEC product." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (!period) {
    return NextResponse.json({ ok: false, error: "FFIEC period is required." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (!isFormat(format)) {
    return NextResponse.json({ ok: false, error: "Invalid FFIEC format." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const file = await downloadFfiecBulkFile({
      productId: product,
      periodValue: period,
      format,
    });

    return new NextResponse(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        "Content-Type": file.contentType,
        "Content-Disposition": file.contentDisposition,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "FFIEC download failed.",
      },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
