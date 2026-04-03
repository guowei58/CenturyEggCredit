"use client";

import { useEffect, useMemo, useState } from "react";
import { usePromptTemplateOverride } from "@/lib/prompt-template-overrides";

export function PromptTemplateBox({
  tabId,
  defaultTemplate,
  resolve,
  className = "",
}: {
  tabId: string;
  defaultTemplate: string;
  resolve: (template: string) => string;
  className?: string;
}) {
  const { template, setTemplate, resetToDefault, isOverridden } = usePromptTemplateOverride(tabId, defaultTemplate);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(template);

  useEffect(() => {
    if (!isEditing) setDraft(template);
  }, [template, isEditing]);

  const preview = useMemo(() => resolve(isEditing ? draft : template), [resolve, template, draft, isEditing]);

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
          Prompt {isOverridden ? "(custom)" : ""}
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <button
                type="button"
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                onClick={() => {
                  setTemplate(draft);
                  setIsEditing(false);
                }}
              >
                Save prompt
              </button>
              <button
                type="button"
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "var(--border2)", color: "var(--text)", background: "transparent" }}
                onClick={() => {
                  setDraft(template);
                  setIsEditing(false);
                }}
              >
                Cancel
              </button>
              {isOverridden ? (
                <button
                  type="button"
                  className="tab-prompt-ai-action-btn"
                  style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
                  onClick={() => {
                    resetToDefault();
                    setIsEditing(false);
                  }}
                  title="Reset to the built-in default prompt"
                >
                  Reset
                </button>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className="tab-prompt-ai-action-btn"
              style={{ borderColor: "var(--border2)", color: "var(--text)", background: "transparent" }}
              onClick={() => setIsEditing(true)}
            >
              Edit prompt
            </button>
          )}
        </div>
      </div>

      {isEditing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="rounded border p-3 text-xs w-full min-h-[160px] resize-y whitespace-pre-wrap"
          style={{ borderColor: "var(--border2)", color: "var(--text)", background: "var(--card)" }}
        />
      ) : null}

      <div
        className="rounded border p-3 text-xs max-h-[200px] overflow-y-auto whitespace-pre-wrap"
        style={{ borderColor: "var(--border2)", color: "var(--text)", background: "var(--card)" }}
      >
        {preview}
      </div>
    </div>
  );
}

