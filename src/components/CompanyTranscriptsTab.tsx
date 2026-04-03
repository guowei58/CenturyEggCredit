"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";

const ROIC_AI_TRANSCRIPTS_BASE = "https://www.roic.ai/quote";

export function CompanyTranscriptsTab({ ticker }: { ticker: string }) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const safeTicker = ticker?.trim() ?? "";
  const transcriptsUrl = safeTicker
    ? `${ROIC_AI_TRANSCRIPTS_BASE}/${encodeURIComponent(safeTicker)}/transcripts`
    : "";

  useEffect(() => {
    setStatusMessage(null);
  }, [safeTicker]);

  async function copyLink() {
    if (!transcriptsUrl) return;
    setStatusMessage(null);
    try {
      await navigator.clipboard.writeText(transcriptsUrl);
      setStatusMessage("Link copied to clipboard.");
    } catch {
      setStatusMessage("Could not copy. Use the link above.");
    }
  }

  function openInRoic() {
    if (!transcriptsUrl) return;
    window.open(transcriptsUrl, "_blank", "noopener,noreferrer");
    setStatusMessage("Opened in new tab.");
  }

  if (!safeTicker) {
    return (
      <Card title="Transcripts">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to open transcripts on ROIC.AI.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Transcripts — ${safeTicker}`}>
      <p className="text-sm mb-3" style={{ color: "var(--muted2)" }}>
        Opens ROIC.AI with transcripts for this ticker. The link already includes the ticker — click to view.
      </p>
      <div className="rounded border p-3 mb-4 text-sm break-all" style={{ borderColor: "var(--border2)", color: "var(--text)", background: "var(--card)" }}>
        <a
          href={transcriptsUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--blue)" }}
        >
          {transcriptsUrl}
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          type="button"
          onClick={openInRoic}
          className="rounded border px-3 py-1.5 text-sm font-medium"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
        >
          Open in ROIC.AI
        </button>
        <button
          type="button"
          onClick={copyLink}
          className="tab-prompt-ai-action-btn"
          style={{ borderColor: "var(--border2)", color: "var(--text)" }}
        >
          Copy link
        </button>
      </div>
      {statusMessage && (
        <p className="text-sm mb-2" style={{ color: "var(--muted2)" }}>
          {statusMessage}
        </p>
      )}
    </Card>
  );
}
