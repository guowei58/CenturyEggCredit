"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Card } from "@/components/ui";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { SavedResponseExpandableShell, SAVED_RESPONSE_FS_FILL_CLASS } from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";

function linkify(text: string): ReactNode[] {
  const urlRegex = /(https?:\/\/[^\s<>"')\]\}]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="underline break-all"
        style={{ color: "var(--accent)" }}
      >
        {part}
      </a>
    ) : (
      part
    )
  );
}

export function CompanyNotesThoughtsTab({ ticker }: { ticker: string }) {
  const safeTicker = ticker?.trim() ?? "";
  const [savedContent, setSavedContent] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [isEditing, setIsEditing] = useState(true);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, "notes-thoughts");
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
    if (!safeTicker) return;
    const trimmed = editDraft.trim();
    await saveToServer(safeTicker, "notes-thoughts", trimmed);
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
      <Card title="Notes & Thoughts">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to add notes.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Notes & Thoughts — ${safeTicker}`}>
      <SavedResponseExpandableShell
        title="Saved notes"
        className="min-w-0 flex-1"
        ticker={safeTicker}
        linkSourceText={isEditing ? editDraft : savedContent}
      >
        {isEditing ? (
          <>
            <RichPasteTextarea
              value={editDraft}
              onChange={setEditDraft}
              placeholder="Write notes, links, and loose thoughts here, then click Save."
              className={`min-h-[50vh] w-full flex-1 resize-y rounded border bg-[var(--card2)] px-3 py-3 text-sm leading-relaxed placeholder:font-sans focus:border-[var(--accent)] focus:outline-none lg:min-h-[60vh] ${SAVED_RESPONSE_FS_FILL_CLASS}`}
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            />
            <button
              type="button"
              onClick={handleSave}
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
                <span style={{ color: "var(--muted)" }}>No saved notes yet.</span>
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

