import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getEggHocMessageImageForViewer } from "@/lib/egg-hoc-chat/service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { messageId: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const messageId = params.messageId?.trim();
  if (!messageId) return NextResponse.json({ error: "Missing message id" }, { status: 400 });

  const r = await getEggHocMessageImageForViewer(messageId, userId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  return new NextResponse(new Uint8Array(r.bytes), {
    status: 200,
    headers: {
      "Content-Type": r.mime,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
