"use client";
import { withPromptBenchmarkNotice } from "@/lib/prompt-benchmark-notice";
import { fillCompanyPromptTemplate } from "@/lib/company-prompt-labels";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card } from "@/components/ui";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { OPEN_IN_EXTERNAL_AI_FULL_LINE } from "@/lib/gemini-open-url";
import { SavedResponseExpandableShell, SAVED_RESPONSE_EDIT_CLASS, SAVED_RESPONSE_SHELL_CLASS, SAVED_RESPONSE_VIEW_CLASS } from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { PromptTemplateBox } from "@/components/PromptTemplateBox";
import { TabPromptOpenInAiButtons } from "@/components/TabPromptOpenInAiButtons";
import { useTabPromptExport } from "@/lib/use-tab-prompt-export";
import { TabPromptSlideOutShell } from "@/components/TabPromptSlideOutShell";
import { usePromptTemplateOverride } from "@/lib/prompt-template-overrides";

export const PROMPT_TEMPLATE = `Give me a comprehensive history of [COMPANY NAME] / [TICKER] from its founding to today.

I want this written as a detailed chronological timeline in bullet points.

For each bullet point:
- include the date or year
- describe what happened
- explain why it mattered strategically, financially, or competitively
- include a link to the original source document or the best primary/reputable source available

Cover the company's full history, including but not limited to:

1. Founding and early history
- founding date
- founder(s)
- original business model
- early ownership and control
- initial geographic footprint
- major early milestones

2. Business evolution
- major business line entries and exits
- product launches or service launches that changed the company
- strategic pivots
- expansion into new geographies or customer segments
- changes in distribution model or go-to-market strategy

3. M&A and portfolio changes
- acquisitions
- mergers
- divestitures
- spin-offs
- carve-outs
- joint ventures
- discontinued operations
- asset sales
- failed or proposed deals, if important

4. Capital markets and financial history
- IPO
- secondary offerings
- major debt issuances
- recapitalizations
- refinancing transactions
- liability management exercises
- bankruptcies or near-bankruptcies
- restructurings
- dividend recap transactions
- share repurchases or large capital allocation shifts

5. Management and ownership changes
- CEO changes
- CFO changes
- chairman changes
- founder departures
- activist involvement
- sponsor / private equity ownership changes
- major board changes
- governance disputes

6. Strategy and operating performance
- major strategic plans
- transformation programs
- restructuring plans
- cost-cutting initiatives
- margin improvement plans
- major operational failures or successes
- secular tailwinds or headwinds that changed the story

7. Controversies, litigation, and regulatory issues
- big controversies
- scandals
- lawsuits
- investigations
- regulatory fines or settlements
- accounting issues
- short seller reports
- labor issues
- environmental / safety incidents
- antitrust or FCC / FTC / DOJ issues if relevant

8. Industry and competitive context
- major industry events that materially affected the company
- important competitive threats
- technology shifts
- deregulation / regulation
- macro events that changed the company's trajectory

9. Important media coverage
- major Wall Street Journal articles
- major New York Times / FT / Bloomberg / Reuters stories
- important investigative reports
- especially articles that changed investor, creditor, customer, or regulatory perception

10. Current setup
- what the company looks like today versus at founding
- current business segments
- current ownership / control if relevant
- current major strategic questions

Research requirements:
- prioritize primary sources where possible:
 - company filings
 - annual reports
 - investor presentations
 - merger documents
 - proxy statements
 - bankruptcy filings
 - court documents
 - press releases
 - regulatory filings
- use reputable news sources for context where primary sources are not enough
- include links for every important bullet point
- if there are conflicting accounts, mention the disagreement briefly
- do not skip ugly or controversial periods
- do not give a short summary - be exhaustive
- if the company has gone through predecessor entities, name changes, or major reorganizations, include those too

Output format:
- organize strictly in chronological bullet points
- use subheadings by era / decade if helpful
- keep each bullet concise but informative
- include source links inline in each bullet
- add a final section called:
  1. "Most Important Turning Points"
  2. "Open Questions / Areas for Further Research"

Also include these categories if relevant and often overlooked:
- major customer wins or losses
- union / labor developments
- credit rating changes
- covenant / financing turning points
- accounting changes / restatements
- tax-driven restructurings
- spectrum / licenses / permits / concessions
- international expansion or retreat
- cyber incidents / data breaches
- supply chain disruptions
- key subsidiary creations or dissolutions`;

export function buildCompanyHistoryAiPrompt(
  ticker: string,
  companyName?: string | null,
  template: string = PROMPT_TEMPLATE
): string {
  const safeTicker = ticker.trim();
  if (!safeTicker) return "";
  return fillCompanyPromptTemplate(template, safeTicker, companyName);
}

/** Best-effort: Claude has used ?q= for prefill; not officially documented and may change. */

/** Split text by URLs and return React nodes: plain text and clickable links (new tab). Stops at ), ], } so parentheticals aren't part of the link. */
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

export function CompanyHistoryTab({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName?: string | null;
}) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const [savedContent, setSavedContent] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [isEditing, setIsEditing] = useState(true);

  const safeTicker = ticker?.trim() ?? "";
  const displayName = (companyName?.trim() || safeTicker) || "";
  const { template: historyTemplate } = usePromptTemplateOverride("company-history", PROMPT_TEMPLATE);
  const prompt = safeTicker
    ? historyTemplate.replace(/\[COMPANY NAME\]/g, displayName).replace(
        /\[TICKER\]/g,
        safeTicker
      )
    : "";

  const fillPrompt = useCallback(() => prompt, [prompt]);
  const { onResolvedPromptChange, getPromptForExport, isEditingPrompt } = useTabPromptExport(fillPrompt);

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker, displayName]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, "company-history");
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

  async function handleSaveResponse() {
    const trimmed = editDraft.trim();
    if (!safeTicker) return;
    await saveToServer(safeTicker, "company-history", trimmed);
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
      <Card title="Company History">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to open this prompt in Claude, ChatGPT, Gemini, or DeepSeek.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Company History - ${safeTicker}`}>
      <TabPromptSlideOutShell
        hasMainContent={savedContent.trim().length > 0}
        main={
          <SavedResponseExpandableShell
          className={SAVED_RESPONSE_SHELL_CLASS}
          ticker={safeTicker}
          linkSourceText={isEditing ? editDraft : savedContent}
        >
          {isEditing ? (
            <>
              <RichPasteTextarea
                value={editDraft}
                onChange={setEditDraft}
                placeholder="Paste your Claude, ChatGPT, Gemini, or DeepSeek response here, then click Save."
                className={SAVED_RESPONSE_EDIT_CLASS}
                style={{
                  borderColor: "var(--border2)",
                  color: "var(--text)",
                }}
              />
              <button
                type="button"
                onClick={handleSaveResponse}
                className="mt-3 shrink-0 rounded border px-4 py-2 text-sm font-medium"
                style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
              >
                Save
              </button>
            </>
          ) : (
            <>
              <div
                className={SAVED_RESPONSE_VIEW_CLASS}
                style={{ color: "var(--text)" }}
              >
                {savedContent ? <SavedRichText content={savedContent} ticker={safeTicker} /> : (
                  <span style={{ color: "var(--muted)" }}>No saved response yet.</span>
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
        }
        prompt={
          <>
          <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
            {OPEN_IN_EXTERNAL_AI_FULL_LINE}
          </p>
          <PromptTemplateBox
            tabId="company-history"
            defaultTemplate={PROMPT_TEMPLATE}
            resolve={(tpl) =>
              safeTicker ? tpl.replace(/\[COMPANY NAME\]/g, displayName).replace(/\[TICKER\]/g, safeTicker) : ""
            }
              onResolvedPromptChange={onResolvedPromptChange}
            className="mb-3"
          />
          
<TabPromptOpenInAiButtons
  prompt={prompt}
  getPrompt={getPromptForExport}
  isEditingPrompt={isEditingPrompt}
  setStatusMessage={setStatusMessage}
              setClipboardFailed={setClipboardFailed}
            />
            <TabPromptApiButtons
            researchSaveKey="company-history"
            userPrompt={prompt}
            onResult={() => {
              setClipboardFailed(false);
            }}
            persistAfterResult={async (text) => {
              const trimmed = text.trim();
              if (!safeTicker) return;
              const ok = await saveToServer(safeTicker, "company-history", trimmed);
              if (!ok) throw new Error("Could not save response.");
              setSavedContent(trimmed);
              setIsEditing(false);
              setEditDraft("");
              setStatusMessage("Response saved.");
            }}
            className="mt-3 border-t border-[var(--border2)] pt-3"
          />
          {statusMessage && (
            <p className="text-xs mb-1" style={{ color: "var(--muted2)" }}>
              {statusMessage}
            </p>
          )}
          {clipboardFailed && getPromptForExport().trim() && (
            <p className="text-[10px] mt-1" style={{ color: "var(--muted2)" }}>
              Select the prompt above and copy manually (Ctrl+C / Cmd+C).
            </p>
          )}
          </>
        }
      />
    </Card>
  );
}
