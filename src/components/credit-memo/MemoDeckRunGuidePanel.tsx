"use client";

import { Card } from "@/components/ui";
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

export function MemoDeckRunGuidePanel({ run }: { run: MemoDeckRunGuideState | null }) {
  if (!run) {
    return (
      <Card title="Last run — size and embedding diagnostics">
        <details
          className="rounded border text-[11px] leading-snug overflow-x-auto"
          style={{ borderColor: "var(--border2)" }}
        >
          <summary
            className="cursor-pointer px-3 py-2 text-xs font-medium"
            style={{ background: "var(--card2)" }}
          >
            Expand — default chunking &amp; embedding mechanics (generate once to see numbers from your last run)
          </summary>
          <div className="border-t px-3 py-2 space-y-2" style={{ borderColor: "var(--border2)" }}>
            <p className="text-[11px] leading-relaxed mb-0" style={{ color: "var(--muted2)" }}>
              <strong>Run Generate credit memo</strong> or <strong>Generate credit Deck</strong> once to fill this with
              numbers from that run (chunk counts, evidence caps, embedding mode, and optional full prompts). The text
              below describes the default mechanics.
            </p>
            <p className="mb-0 leading-relaxed" style={{ color: "var(--muted2)" }}>
              Ingest splits each source into chunks of up to {CREDIT_MEMO_CHUNK_MAX_CHARS.toLocaleString()} characters
              (overlap {CREDIT_MEMO_CHUNK_OVERLAP_CHARS.toLocaleString()}). With an embedding-capable key (OpenAI, Gemini, or
              DeepSeek in Settings), chunks are vectorized; the run embeds your memo or deck <strong>outline as one
              query</strong> and rank-packs the best-matching chunk texts into the evidence cap (cosine similarity, then
              greedy pack by score). Without a compatible key, the pack is built in file order up to the same cap.
            </p>
          </div>
        </details>
      </Card>
    );
  }

  const d = run.evidenceDiagnostics;
  const bridgeLabel =
    run.kind === "memo"
      ? "Closing (---, instructions after evidence)"
      : "Closing (JSON instruction after evidence)";

  return (
    <Card title="Last run — size and embedding diagnostics">
      <details
        className="mb-4 rounded border text-[11px] leading-snug overflow-x-auto"
        style={{ borderColor: "var(--border2)" }}
      >
        <summary
          className="cursor-pointer px-3 py-2 text-xs font-medium"
          style={{ background: "var(--card2)" }}
        >
          How chunking &amp; context were computed
        </summary>
        <div className="border-t" style={{ borderColor: "var(--border2)" }}>
          <p className="px-3 py-2 mb-0 leading-relaxed" style={{ color: "var(--muted2)" }}>
            From your last <strong>{run.kind === "memo" ? "Generate credit memo" : "Generate credit Deck"}</strong>. Ingest
            splits each source into chunks of up to {d.ingestChunkMaxChars.toLocaleString()} characters (overlap{" "}
            {d.ingestChunkOverlapChars.toLocaleString()}). With an embedding key, chunks are vectorized; the run embeds
            your memo or deck <strong>outline as one query</strong> and rank-packs the best-matching chunk texts into the
            evidence cap (cosine similarity, then greedy pack by score).
            {run.kind === "deck" ? (
              <>
                {" "}
                Deck download responses do not include full prompt text; character counts are shown below.
              </>
            ) : null}
          </p>
          <div
            className="px-3 py-2 font-semibold border-t"
            style={{ background: "var(--card2)", color: "var(--muted2)", borderColor: "var(--border2)" }}
          >
            Evidence &amp; chunk math
          </div>
          <table className="w-full min-w-[280px] text-left border-t" style={{ borderColor: "var(--border2)" }}>
            <tbody style={{ color: "var(--text)" }}>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-3 py-1.5 font-medium align-top w-[52%]" style={{ color: "var(--muted2)" }}>
                  Raw sources total (ingest, non-skipped files)
                </th>
                <td className="px-3 py-1.5 font-mono tabular-nums">
                  {d.rawSourceCharsSum.toLocaleString()} chars
                </td>
              </tr>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  Ingest chunk size (max) / overlap
                </th>
                <td className="px-3 py-1.5 font-mono tabular-nums">
                  {d.ingestChunkMaxChars.toLocaleString()} / {d.ingestChunkOverlapChars.toLocaleString()} chars
                </td>
              </tr>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  Chunks in project (non-empty / total)
                </th>
                <td className="px-3 py-1.5 font-mono tabular-nums">
                  {d.nonEmptyChunkCount.toLocaleString()} / {d.projectChunkCount.toLocaleString()}
                </td>
              </tr>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  Evidence / bundle cap
                </th>
                <td className="px-3 py-1.5 font-mono tabular-nums">
                  {d.evidenceCharCap.toLocaleString()} chars
                </td>
              </tr>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  Final evidence string (bodies + SOURCE headers)
                </th>
                <td className="px-3 py-1.5 font-mono tabular-nums">
                  {d.evidencePackChars.toLocaleString()} chars
                </td>
              </tr>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  Retrieval query (outline) / embedded slice
                </th>
                <td className="px-3 py-1.5 font-mono tabular-nums text-[10px]">
                  {d.retrievalQueryChars.toLocaleString()} chars → embed max {d.queryEmbeddedChars.toLocaleString()}
                </td>
              </tr>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  Embedding mode
                </th>
                <td className="px-3 py-1.5" style={{ color: "var(--text)" }}>
                  {d.mode === "retrieval" ? (
                    <span style={{ color: "var(--accent)" }}>Project-chunk rank (cosine + greedy pack)</span>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>
                      Sequential pack (file order) — {d.fallbackReason ? fallbackReasonLabel(d.fallbackReason) : "—"}
                    </span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          {d.mode === "retrieval" ? (
            <div
              className="border-t px-3 py-2 text-[10px] leading-relaxed space-y-2"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            >
              <div className="font-semibold" style={{ color: "var(--muted2)" }}>
                Embedding &amp; rank details
              </div>
              <ul className="list-none space-y-1 pl-0" style={{ color: "var(--muted)" }}>
                <li>
                  <span className="font-medium" style={{ color: "var(--text)" }}>Provider / model: </span>
                  {d.embeddingProvider ?? "—"} · {d.embeddingModel ?? "—"}{" "}
                  {d.embeddingDimensions != null ? `· ${d.embeddingDimensions}D` : ""}
                </li>
                <li>
                  <span className="font-medium" style={{ color: "var(--text)" }}>Chunk vectors: </span>
                  {d.chunksEmbedded != null ? d.chunksEmbedded.toLocaleString() : "—"} (cached under{" "}
                  <code className="text-[9px]">credit-memo/kpi-embeddings/</code>)
                </li>
                <li>
                  <span className="font-medium" style={{ color: "var(--text)" }}>Chunks in ranked window: </span>
                  {d.chunksInWindow != null ? d.chunksInWindow.toLocaleString() : "—"} (cosine + greedy until cap)
                </li>
              </ul>
              <div>
                <div className="font-semibold mb-0.5" style={{ color: "var(--muted2)" }}>
                  Query lines (embedded as one vector)
                </div>
                <ul className="list-disc pl-4 space-y-1 font-mono text-[9px] break-words opacity-95 max-h-32 overflow-y-auto">
                  {d.rankingQueryLines.length > 0 ? (
                    d.rankingQueryLines.map((line, i) => <li key={`q-${i}`}>{line}</li>)
                  ) : (
                    <li className="list-none">(empty)</li>
                  )}
                </ul>
              </div>
              {d.documentsInWindow.length > 0 ? (
                <div>
                  <div className="font-semibold mb-0.5" style={{ color: "var(--muted2)" }}>
                    Source files with at least one chunk in the window
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded border" style={{ borderColor: "var(--border2)" }}>
                    <table className="w-full min-w-[240px] text-left text-[9px]">
                      <thead style={{ color: "var(--muted2)" }}>
                        <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                          <th className="px-2 py-1 font-medium w-8">#</th>
                          <th className="px-2 py-1 font-medium">Path</th>
                          <th className="px-2 py-1 font-medium text-right">Chunks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.documentsInWindow.map((row, idx) => (
                          <tr key={row.relPath} className="border-b" style={{ borderColor: "var(--border2)" }}>
                            <td
                              className="px-2 py-1 font-mono tabular-nums align-top"
                              style={{ color: "var(--muted)" }}
                            >
                              {idx + 1}
                            </td>
                            <td className="px-2 py-1 min-w-0 break-all" title={row.relPath}>
                              {row.relPath}
                            </td>
                            <td className="px-2 py-1 font-mono text-right tabular-nums">
                              {row.chunkCount.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <div
            className="px-3 py-2 font-semibold border-t"
            style={{ background: "var(--card2)", color: "var(--muted2)", borderColor: "var(--border2)" }}
          >
            User message (task + evidence + closings)
          </div>
          <table className="w-full min-w-[280px] text-left border-t" style={{ borderColor: "var(--border2)" }}>
            <tbody>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  Evidence block string
                </th>
                <td className="px-3 py-1.5 font-mono tabular-nums">
                  {run.userBreakdown.formattedSourcesChars.toLocaleString()} chars
                </td>
              </tr>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  Preamble (memo / deck spec + inventory + <code className="text-[9px]"># EVIDENCE</code>)
                </th>
                <td className="px-3 py-1.5 font-mono tabular-nums">
                  {run.userBreakdown.taskSpecChars.toLocaleString()} chars
                </td>
              </tr>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  {bridgeLabel}
                </th>
                <td className="px-3 py-1.5 font-mono tabular-nums">
                  {run.userBreakdown.bridgeChars.toLocaleString()} chars
                </td>
              </tr>
              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  User message total
                </th>
                <td className="px-3 py-1.5 font-mono tabular-nums font-semibold">
                  {run.userBreakdown.totalUserMessageChars.toLocaleString()} chars
                </td>
              </tr>
              <tr>
                <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                  System message
                </th>
                <td className="px-3 py-1.5 font-mono tabular-nums">
                  {run.systemChars.toLocaleString()} chars
                </td>
              </tr>
            </tbody>
          </table>
          {run.userMessageCharsOnly != null && !run.sentUserMessage ? (
            <p
              className="px-3 py-2 text-[10px] border-t"
              style={{ borderColor: "var(--border2)", color: "var(--muted)" }}
            >
              User message for this deck run: <strong>{run.userMessageCharsOnly.toLocaleString()}</strong> characters (full
              text is not included on file download; run a credit memo to capture the full prompt in this panel).
            </p>
          ) : null}
        </div>
      </details>
      {run.sentSystemMessage && run.sentUserMessage ? (
        <>
          <details className="mb-2 rounded border" style={{ borderColor: "var(--border2)" }}>
            <summary
              className="cursor-pointer px-3 py-2 text-xs font-medium"
              style={{ background: "var(--card2)" }}
            >
              System message ({run.sentSystemMessage.length.toLocaleString()} characters)
            </summary>
            <pre
              className="max-h-40 overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-[10px] leading-snug font-mono border-t"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            >
              {run.sentSystemMessage}
            </pre>
          </details>
          <details className="rounded border" style={{ borderColor: "var(--border2)" }}>
            <summary
              className="cursor-pointer px-3 py-2 text-xs font-medium"
              style={{ background: "var(--card2)" }}
            >
              User message — task + evidence ({run.sentUserMessage.length.toLocaleString()} characters)
            </summary>
            <pre
              className="max-h-[min(70vh,32rem)] overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-[10px] leading-snug font-mono border-t"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            >
              {run.sentUserMessage}
            </pre>
          </details>
        </>
      ) : null}
    </Card>
  );
}
