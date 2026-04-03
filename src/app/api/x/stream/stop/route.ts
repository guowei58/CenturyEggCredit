import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Stub for future filtered stream rule management. */
export async function POST() {
  return NextResponse.json({ ok: false, error: "Filtered stream stop not implemented yet." }, { status: 501 });
}

