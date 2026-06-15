"use client";

import type { LmeUserMessageCharBreakdown } from "@/lib/lme-analysis-synthesis";
import type { CreditMemoEvidenceDiagnostics } from "@/lib/creditMemo/kpiRetrieval";
import { CREDIT_MEMO_CHUNK_MAX_CHARS, CREDIT_MEMO_CHUNK_OVERLAP_CHARS } from "@/lib/creditMemo/chunkConstants";

function fallbackReasonLabel(r: CreditMemoEvidenceDiagnostics["fallbackReason"]): string {
  switch (r) {
    case "retrieval_disabled":
      return "MEMO_RETRIEVAL off (or 0/false)";
    case "no_embedding_key":
      return "No OpenAI, Gemini, or DeepSeek key for embeddings";
    case "no_user":
      return "Not signed in";
    case "no_chunks":
      return "No text chunks after ingest";
    case "embed_failed":
      return "Embedding API failed or returned no query vector";
    case "empty_window":
      return "Ranked window empty (unexpected)";
    case "error":
      return "Exception during ranked pack";
    default:
      return "—";
  }
}

export type MemoDeckRunGuideState = {
  kind: "memo" | "deck";
  evidenceDiagnostics: CreditMemoEvidenceDiagnostics;
  userBreakdown: LmeUserMessageCharBreakdown;
  systemChars: number;
  /** Full messages for memo; deck may omit or use length-only. */
  sentSystemMessage?: string;
  sentUserMessage?: string;
  userMessageCharsOnly?: number;
};

function EmptyRunGuideBody() {
  return (
    <div className="space-y-2 py-1">
      <p className="text-[10px] leading-relaxed mb-0" style={{ color: "var(--muted2)" }}>
        Click <strong>Build context window</strong> once to fill this with numbers from that run (chunk counts, evidence
        caps, embedding mode, and optional full prompts).
      </p>
      <p className="mb-0 text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
        Ingest splits each source into chunks of up to {CREDIT_MEMO_CHUNK_MAX_CHARS.toLocaleString()} characters (overlap{" "}
        {CREDIT_MEMO_CHUNK_OVERLAP_CHARS.toLocaleString()}). With an embedding-capable key, chunks are vectorized; the
        outline is embedded as one query and rank-packed into the evidence cap.
      </p>
    </div>
  );
}

function RunGuideBody({ run }: { run: MemoDeckRunGuideState }) {
  const d = run.evidenceDiagnostics;

  return (
    <div className="space-y-2 py-1">
      <details
        className="rounded border text-[10px] leading-snug overflow-x-auto"
        style={{ borderColor: "var(--border2)" }}
      >
        <summary
          className="cursor-pointer px-2.5 py-1.5 text-[11px] font-medium"
          style={{ background: "var(--card2)", color: "var(--muted2)" }}
        >
          How chunking &amp; context were computed
        </summary>
        <div className="border-t" style={{ borderColor: "var(--border2)" }}>
          <p className="px-2.5 py-2 mb-0 leading-relaxed text-[10px]" style={{ color: "var(--muted2)" }}>
            From your last <strong>Build context window</strong> ({run.kind === "memo" ? "memo" : "deck"} prompt).
          </p>
          <div
            className="px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wide border-t"
            style={{ background: "var(--card2)", color: "var(--muted)", borderColor: "var(--border2)" }}
          >
            Evidence &amp; chunk math
          </div>
          <table className="w-full min-w-[240px] text-left border-t text-[10px]" style={{ borderColor: "var(--border2)" }}>
            <tbody style={{ color: "var(--text)" }}>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-2.5 py-1 font-medium align-top w-[52%]" style={{ color: "var(--muted2)" }}>
                  Raw sources total
                </th>
                <td className="px-2.5 py-1 font-mono tabular-nums">{d.rawSourceCharsSum.toLocaleString()} chars</td>
              </tr>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-2.5 py-1 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  Chunk size / overlap
                </th>
                <td className="px-2.5 py-1 font-mono tabular-nums">
                  {d.ingestChunkMaxChars.toLocaleString()} / {d.ingestChunkOverlapChars.toLocaleString()}
                </td>
              </tr>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-2.5 py-1 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  Chunks (non-empty / total)
                </th>
                <td className="px-2.5 py-1 font-mono tabular-nums">
                  {d.nonEmptyChunkCount.toLocaleString()} / {d.projectChunkCount.toLocaleString()}
                </td>
              </tr>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-2.5 py-1 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  Evidence cap / packed
                </th>
                <td className="px-2.5 py-1 font-mono tabular-nums">
                  {d.evidenceCharCap.toLocaleString()} → {d.evidencePackChars.toLocaleString()}
                </td>
              </tr>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-2.5 py-1 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  Embedding mode
                </th>
                <td className="px-2.5 py-1" style={{ color: "var(--text)" }}>
                  {d.mode === "retrieval" ? (
                    <span style={{ color: "var(--accent)" }}>Ranked pack</span>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>
                      Sequential — {d.fallbackReason ? fallbackReasonLabel(d.fallbackReason) : "—"}
                    </span>
                  )}
                </td>
              </tr>
              <tr>
                <th className="px-2.5 py-1 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  System / user message
                </th>
                <td className="px-2.5 py-1 font-mono tabular-nums">
                  {run.systemChars.toLocaleString()} / {run.userBreakdown.totalUserMessageChars.toLocaleString()} chars
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      {run.sentSystemMessage && run.sentUserMessage ? (
        <>
          <details className="rounded border" style={{ borderColor: "var(--border2)" }}>
            <summary
              className="cursor-pointer px-2.5 py-1.5 text-[11px] font-medium"
              style={{ background: "var(--card2)", color: "var(--muted2)" }}
            >
              System message ({run.sentSystemMessage.length.toLocaleString()} characters)
            </summary>
            <pre
              className="max-h-32 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 text-[9px] leading-snug font-mono border-t"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            >
              {run.sentSystemMessage}
            </pre>
          </details>
          <details className="rounded border" style={{ borderColor: "var(--border2)" }}>
            <summary
              className="cursor-pointer px-2.5 py-1.5 text-[11px] font-medium"
              style={{ background: "var(--card2)", color: "var(--muted2)" }}
            >
              User message — task + evidence ({run.sentUserMessage.length.toLocaleString()} characters)
            </summary>
            <pre
              className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 text-[9px] leading-snug font-mono border-t"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            >
              {run.sentUserMessage}
            </pre>
          </details>
        </>
      ) : run.userMessageCharsOnly != null ? (
        <p className="text-[10px]" style={{ color: "var(--muted)" }}>
          User message: {run.userMessageCharsOnly.toLocaleString()} characters (full text not stored for this deck run).
        </p>
      ) : null}
    </div>
  );
}

/** Collapsible diagnostics — intended nested under Memo settings. */
export function MemoDeckRunGuidePanel({ run }: { run: MemoDeckRunGuideState | null }) {
  const summaryHint = run
    ? `${run.kind === "memo" ? "Memo" : "Deck"} · system ${run.systemChars.toLocaleString()} · user ${run.userBreakdown.totalUserMessageChars.toLocaleString()} chars`
    : "Build context window to populate";

  return (
    <details className="rounded border text-xs" style={{ borderColor: "var(--border2)" }}>
      <summary className="cursor-pointer px-3 py-2 font-medium" style={{ color: "var(--muted2)" }}>
        Last run — size and embedding diagnostics
        <span className="ml-2 font-normal text-[10px]" style={{ color: "var(--muted)" }}>
          ({summaryHint})
        </span>
      </summary>
      <div className="border-t px-3 pb-3" style={{ borderColor: "var(--border2)" }}>
        {run ? <RunGuideBody run={run} /> : <EmptyRunGuideBody />}
      </div>
    </details>
  );
}
