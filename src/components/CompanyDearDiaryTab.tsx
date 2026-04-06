"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { SavedResponseExpandableShell, SAVED_RESPONSE_FS_FILL_CLASS } from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";

export function CompanyDearDiaryTab({
  ticker,
}: {
  ticker: string;
}) {
  const safeTicker = ticker?.trim() ?? "";
  const [savedContent, setSavedContent] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [isEditing, setIsEditing] = useState(true);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, "dear-diary");
      if (!cancelled) {
        setSavedContent(loaded);
        setIsEditing(loaded.length === 0);
        setEditDraft("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [safeTicker]);

  async function handleSave() {
    const trimmed = editDraft.trim();
    if (!safeTicker) return;
    await saveToServer(safeTicker, "dear-diary", trimmed);
    setSavedContent(trimmed);
    setIsEditing(false);
    setEditDraft("");
  }

  function handleReplace() {
    setEditDraft(savedContent);
    setIsEditing(true);
  }

  if (!safeTicker) {
    return (
      <Card title="Dear Diary">
        <p className="py-4 text-sm" style={{ color: "var(--muted2)" }}>
          Select a company to open your notebook for that ticker.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Dear Diary — ${safeTicker}`}>
      <p className="mb-5 max-w-3xl text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
        Use this tab as a <span style={{ color: "var(--text)" }}>notebook</span>: jot down quick notes, miscellaneous
        items, and random threads you want to revisit or investigate later. It is not tied to a single prompt—anything
        you save here stays with this company. Paste from the web or from AI tools: formatting is handled the same way
        as the saved response boxes (markdown, cleaned HTML, and images).
      </p>

      <SavedResponseExpandableShell
        className="min-w-0 flex-1"
        ticker={safeTicker}
        linkSourceText={isEditing ? editDraft : savedContent}
      >
        {isEditing ? (
          <>
            <RichPasteTextarea
              value={editDraft}
              onChange={setEditDraft}
              placeholder="Type or paste notes here (markdown, links, tables, images from clipboard), then click Save."
              className={`min-h-[50vh] w-full flex-1 resize-y rounded border bg-[var(--card2)] px-3 py-3 text-sm leading-relaxed placeholder:font-sans focus:border-[var(--accent)] focus:outline-none lg:min-h-[60vh] ${SAVED_RESPONSE_FS_FILL_CLASS}`}
              style={{
                borderColor: "var(--border2)",
                color: "var(--text)",
              }}
            />
            <button
              type="button"
              onClick={() => void handleSave()}
              className="mt-3 shrink-0 rounded border px-4 py-2 text-sm font-medium"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            >
              Save
            </button>
          </>
        ) : (
          <>
            <div
              className={`min-h-[50vh] flex-1 overflow-y-auto rounded border border-transparent px-0 py-2 text-sm leading-relaxed lg:min-h-[60vh] lg:max-h-[65vh] ${SAVED_RESPONSE_FS_FILL_CLASS}`}
              style={{ color: "var(--text)" }}
            >
              {savedContent ? (
                <SavedRichText content={savedContent} ticker={safeTicker} />
              ) : (
                <span style={{ color: "var(--muted)" }}>No notes yet.</span>
              )}
            </div>
            <button
              type="button"
              onClick={handleReplace}
              className="mt-3 shrink-0 rounded border px-4 py-2 text-sm font-medium"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            >
              Replace / Edit
            </button>
          </>
        )}
      </SavedResponseExpandableShell>
    </Card>
  );
}
