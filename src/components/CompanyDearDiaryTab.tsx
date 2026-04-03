"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { SavedResponseExpandableShell, SAVED_RESPONSE_FS_FILL_CLASS } from "@/components/SavedResponseExpandableShell";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";

export function CompanyDearDiaryTab({
  ticker,
}: {
  ticker: string;
}) {
  const safeTicker = ticker?.trim() ?? "";
  const [draft, setDraft] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const lastSavedRef = useRef<string>("");
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    setHydrated(false);
    (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, "dear-diary");
      if (!cancelled) {
        setDraft(loaded);
        lastSavedRef.current = loaded;
        setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [safeTicker]);

  // Debounced autosave to server.
  useEffect(() => {
    if (!safeTicker || !hydrated) return;

    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      const content = draft;
      if (content === lastSavedRef.current) return;
      lastSavedRef.current = content;

      void saveToServer(safeTicker, "dear-diary", content);
    }, 650);

    return () => {
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    };
  }, [draft, hydrated, safeTicker]);

  if (!safeTicker) {
    return (
      <Card title="Dear Diary">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to start taking notes.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Dear Diary — ${safeTicker}`}>
      <SavedResponseExpandableShell className="min-w-0">
        <RichPasteTextarea
          value={draft}
          onChange={setDraft}
          placeholder="Type notes here… auto-saves as you type."
          className={`min-h-[60vh] w-full resize-y rounded border bg-[var(--card2)] px-3 py-3 text-sm leading-relaxed placeholder:font-sans focus:border-[var(--accent)] focus:outline-none ${SAVED_RESPONSE_FS_FILL_CLASS}`}
          style={{
            borderColor: "var(--border2)",
            color: "var(--text)",
          }}
        />
        <p className="mt-2 text-[10px]" style={{ color: "var(--muted2)" }}>
          Auto-saves after you pause typing.
        </p>
      </SavedResponseExpandableShell>
    </Card>
  );
}

