import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { collectCreditDocReviewBackground } from "@/lib/credit-doc-review-background";

export const dynamic = "force-dynamic";

/** GET — Notes-tab text from latest Capital Structure and Org Chart Excel uploads for distressed doc review prompts. */
export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker } = await params;
  const background = await collectCreditDocReviewBackground(userId, ticker);
  if (!background) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  return NextResponse.json(background);
}
