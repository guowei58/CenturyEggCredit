import { usStateAbbrFromText } from "@/lib/usStates";

/** Best-effort trailing `ST 12345` pattern for US addresses. */
export function guessUsStateFromAddressLine(addr: string | null | undefined): string | null {
  const raw = (addr ?? "").trim();
  if (!raw) return null;
  const zip = /\b([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\s*$/;
  const m = zip.exec(raw);
  if (m) {
    const ab = m[1]!.toUpperCase();
    if (/^[A-Z]{2}$/.test(ab)) return ab;
  }
  const commaParts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    const maybeStateZip = commaParts[commaParts.length - 1] ?? "";
    const m2 = /^([A-Za-z]{2})\s+/.exec(maybeStateZip);
    if (m2) {
      const ab = m2[1]!.toUpperCase();
      if (/^[A-Z]{2}$/.test(ab)) return ab;
    }
  }
  return null;
}

export function statesMentionedInAddressBlock(block: string | null | undefined): string[] {
  const s = (block ?? "").trim();
  if (!s) return [];
  const found = new Set<string>();
  for (const line of s.split(/[\n;]/)) {
    const g = guessUsStateFromAddressLine(line);
    if (g) found.add(g);
    const t = usStateAbbrFromText(line);
    if (t) found.add(t);
  }
  return [...found];
}
