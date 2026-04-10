"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Card } from "@/components/ui";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { openChatGptWithClipboard } from "@/lib/chatgpt-open-url";
import { OPEN_IN_EXTERNAL_AI_FULL_LINE, openGeminiWithClipboard } from "@/lib/gemini-open-url";
import { openDeepSeekWithClipboard } from "@/lib/deepseek-open-url";
import { SavedResponseExpandableShell, SAVED_RESPONSE_FS_FILL_CLASS } from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { PromptTemplateBox } from "@/components/PromptTemplateBox";
import { usePromptTemplateOverride } from "@/lib/prompt-template-overrides";

/** Best-effort: Claude has used ?q= for prefill; not officially documented and may change. */
const CLAUDE_NEW_CHAT_BASE = "https://claude.ai/new";

export const CREDIT_TIMELINE_PROMPT_TEMPLATE = `You are a top-tier distressed debt / special situations credit analyst. I will give you a ticker and you will build a forward-looking credit timeline for the next 24 months.

Your job is to identify every material date, deadline, trigger, milestone, and potential pressure point that could matter to a credit investor, restructuring analyst, or distressed debt trader.

The goal is not just to list maturities. The goal is to map the company’s full credit calendar so I can understand when risk may rise, when optionality narrows, and when management may need to act.

Important instructions:

- Focus on the next 24 months from today.
- Be comprehensive and conservative.
- Use primary sources whenever possible: credit agreements, indentures, amendments, exchange offers, 10-Ks, 10-Qs, 8-Ks, earnings calls, investor presentations, rating reports if available, and any liability management announcements.
- If exact dates are not available, estimate the likely timing and clearly label it as estimated.
- Distinguish clearly between:
  1. hard contractual dates,
  2. likely operational / market dates,
  3. inferred pressure points.
- Tell me what is known, what is uncertain, and what documents I would need to confirm.
- Think like a distressed analyst: focus on refinancing risk, covenant risk, collateral leakage risk, springing maturity risk, liquidity pinch points, and LME setup risk.
- Do not just summarize debt. Build an actionable timeline.

Output instructions:

- Start with one master timeline table covering the next 24 months.
- The timeline table should be the main deliverable.
- After the table, provide commentary and analysis.
- Sort the table in chronological order.
- Be exhaustive: include both exact dates and estimated windows.
- If multiple events happen around the same period, include separate rows unless combining them improves clarity.
- Use concise wording inside the table, then explain significance in the commentary section below.

==================================================
1. MASTER CREDIT TIMELINE TABLE
==================================================

Create a table with these columns:

| Date / Window | Event | Category | Instrument / Document | Hard Date or Estimated | Cash Impact | Covenant / Structural Impact | Why It Matters | Risk Level |

Definitions:
- Date / Window = exact date if known; otherwise estimated month / quarter / range
- Event = short description of the milestone, trigger, payment, deadline, or risk point
- Category = one of:
  - Maturity
  - Coupon / Interest
  - Covenant Test
  - Reporting Deadline
  - Liquidity
  - Call / Redemption
  - Mandatory Prepayment
  - Asset Sale Deadline
  - Borrowing Base / Collateral
  - Amendment / Waiver
  - LME / Restructuring Window
  - Operational / Business
  - Litigation / Regulatory
  - Other
- Instrument / Document = debt tranche, facility, indenture, credit agreement, filing, or other source tied to the event
- Hard Date or Estimated = explicitly say “Hard Date�?or “Estimated�?- Cash Impact = quantify if possible, otherwise state qualitative impact
- Covenant / Structural Impact = explain whether it affects leverage tests, liquidity, springing maturities, collateral, refinancing flexibility, etc.
- Why It Matters = one concise sentence
- Risk Level = Low / Medium / High

Very important:
- Include all debt maturities
- Include all interest / coupon payment dates
- Include covenant test dates and compliance checkpoints
- Include springing maturity triggers
- Include reporting and compliance certificate deadlines
- Include borrowing base or collateral redeterminations
- Include ECF sweep dates, mandatory prepayments, and asset sale reinvestment deadlines
- Include non-call expiries, first call dates, and refinancing windows
- Include likely LME / exchange / amend-and-extend windows
- Include known or likely seasonal liquidity pinch points
- Include major litigation, tax, pension, regulatory, or operational dates that could matter to credit
- Include management action dates where they likely must act before an actual maturity or trigger

After the full table, also provide:

A. Top 10 Most Important Dates / Windows
B. Top 5 Dates Where Management Likely Needs To Act Before The Event
C. Top 5 Hidden / Overlooked Dates

==================================================
2. COMMENTARY AFTER THE TABLE
==================================================

After the timeline table, provide the following analysis sections:

A. Executive Summary
- 1 paragraph on the overall 24-month credit story
- nearest maturity wall
- nearest likely pressure point
- whether runway appears adequate
- most likely area of stress

B. Debt Maturity Analysis
- summarize the maturity wall
- identify which maturities are refinanceable
- identify which maturities could force exchanges, amendments, or asset sales
- identify likely fulcrum tranche(s)

C. Interest / Cash Burden Analysis
- summarize quarterly and annual cash interest burden
- identify the biggest payment dates
- discuss whether interest burden looks manageable relative to liquidity and EBITDA

D. Covenant / Trigger Analysis
- summarize all major covenant tests and other triggers
- explain which covenant is most likely to tighten first
- explain what metrics should be monitored each quarter

E. Liquidity and Runway Analysis
- discuss cash, restricted cash, revolver / ABL availability, seasonal needs, and expected cash burn
- identify quarters where liquidity may tighten
- identify earliest likely need for refinancing, amend-and-extend, exchange, or LME

F. Call / Redemption / Refinancing Flexibility
- explain when debt becomes callable or easier to refinance
- explain windows that open the door for opportunistic refinancing or exchange activity

G. LME / Restructuring Timeline View
- identify the most likely window for an LME, exchange, or restructuring step
- explain which tranche may gain leverage over others and when
- explain what events could shift bargaining power among creditor classes

H. Monitoring Checklist
List:
- metrics to track each quarter
- disclosures to watch in filings and earnings calls
- phrases that may signal refinancing stress
- phrases that may signal covenant pressure
- phrases that may signal an LME or exchange setup

I. Missing Documents / Confirmation Items
List any missing:
- credit agreements
- amendments
- indentures
- compliance certificates
- borrowing base certificates
- collateral docs
- ABS / securitization docs
- hedge disclosures
- rating reports
- intercreditor agreements
- any other document needed to confirm the timeline

For each missing item, explain why it matters and what timeline item it would clarify.

==================================================
3. FINAL DISTILLED VIEW
==================================================

End with:
- single most important future date or window
- single biggest risk over the next 24 months
- single biggest source of upside / improving flexibility
- most likely refinancing or restructuring path
- 3 things a distressed analyst should watch immediately

Final instructions:
- The table comes first.
- Commentary comes after the table.
- Be exhaustive on dates, but concise inside the table.
- Put the deeper reasoning in the commentary section.
- Distinguish hard dates from estimates.
- If an item is inferred rather than explicitly disclosed, label it clearly.
- Think like a distressed analyst preparing ahead of a liquidity or restructuring event.

I will now give you the ticker:

[TICKER]`;

export function buildCreditTimelineAiPrompt(ticker: string, template: string = CREDIT_TIMELINE_PROMPT_TEMPLATE): string {
  const t = ticker.trim();
  return t ? template.replace("[TICKER]", t) : "";
}

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

export function CompanyCreditTimelineTab({
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
  const { template: creditTimelineTemplate } = usePromptTemplateOverride("credit-timeline", CREDIT_TIMELINE_PROMPT_TEMPLATE);
  const prompt = safeTicker
    ? creditTimelineTemplate.replace("[TICKER]", safeTicker)
    : "";

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, "credit-timeline");
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
    await saveToServer(safeTicker, "credit-timeline", trimmed);
    setSavedContent(trimmed);
    setIsEditing(false);
    setEditDraft("");
  }

  function handleReplace() {
    setEditDraft(savedContent);
    setIsEditing(true);
  }

  async function copyToClipboard() {
    if (!prompt) return;
    setClipboardFailed(false);
    setStatusMessage(null);
    try {
      await navigator.clipboard.writeText(prompt);
      setStatusMessage("Copied to clipboard.");
    } catch {
      setClipboardFailed(true);
      setStatusMessage("Could not copy. Use the prompt below and copy manually.");
    }
  }

  function openInClaude() {
    if (!prompt) return;
    setStatusMessage(null);
    setClipboardFailed(false);
    const prefillUrl = `${CLAUDE_NEW_CHAT_BASE}?q=${encodeURIComponent(prompt)}`;
    window.open(prefillUrl, "_blank", "noopener,noreferrer");
    try {
      navigator.clipboard.writeText(prompt).then(
        () =>
          setStatusMessage("Claude opened in a new tab. Prompt copied to clipboard �?paste into Claude if it didn't prefill."),
        () => {
          setClipboardFailed(true);
          setStatusMessage("Claude opened in a new tab. Prompt could not be copied �?use the prompt below and paste into Claude.");
        }
      );
    } catch {
      setClipboardFailed(true);
      setStatusMessage("Claude opened in a new tab. Prompt could not be copied �?use the prompt below and paste into Claude.");
    }
  }

  function openInChatGPT() {
    if (!prompt) return;
    void openChatGptWithClipboard(prompt, setStatusMessage, setClipboardFailed);
  }

  function openInDeepSeek() {
    if (!prompt) return;
    openDeepSeekWithClipboard(prompt, setStatusMessage, setClipboardFailed);
  }

  function openInGemini() {
    if (!prompt) return;
    openGeminiWithClipboard(prompt, setStatusMessage, setClipboardFailed);
  }

  if (!safeTicker) {
    return (
      <Card title="Credit Timeline">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to open this prompt in Claude, ChatGPT, Gemini, or DeepSeek.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Credit Timeline �?${safeTicker}`}>
      <div className="flex flex-col gap-6 lg:flex-row">
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
                placeholder="Paste your Claude, ChatGPT, Gemini, or DeepSeek response here, then click Save."
                className={`min-h-[50vh] w-full flex-1 resize-y rounded border bg-[var(--card2)] px-3 py-3 text-sm leading-relaxed placeholder:font-sans focus:border-[var(--accent)] focus:outline-none lg:min-h-[60vh] ${SAVED_RESPONSE_FS_FILL_CLASS}`}
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
                className={`min-h-[50vh] flex-1 overflow-y-auto rounded border border-transparent px-0 py-2 text-sm leading-relaxed lg:min-h-[60vh] lg:max-h-[65vh] ${SAVED_RESPONSE_FS_FILL_CLASS}`}
                style={{ color: "var(--text)" }}
              >
                {savedContent ? <SavedRichText content={savedContent} ticker={safeTicker} /> : <span style={{ color: "var(--muted)" }}>No saved response yet.</span>}
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

        <div className="flex w-full flex-col lg:w-80 flex-shrink-0">
          <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
            {OPEN_IN_EXTERNAL_AI_FULL_LINE}
          </p>
          <PromptTemplateBox
            tabId="credit-timeline"
            defaultTemplate={CREDIT_TIMELINE_PROMPT_TEMPLATE}
            resolve={(tpl) => (safeTicker ? tpl.replace("[TICKER]", safeTicker) : "")}
            className="mb-3"
          />
          <div className="tab-prompt-ai-actions-grid mb-2">
            <button
              type="button"
              onClick={openInClaude}
              className="tab-prompt-ai-action-btn"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            >
              Open in Claude
            </button>
            <button
              type="button"
              onClick={openInChatGPT}
              className="tab-prompt-ai-action-btn"
              style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "transparent" }}
            >
              Open in ChatGPT
            </button>
            <button
              type="button"
              onClick={openInGemini}
              className="tab-prompt-ai-action-btn"
              style={{ borderColor: "#EAB308", color: "#EAB308", background: "transparent" }}
            >
              Open in Gemini
            </button>
            <button
              type="button"
              onClick={openInDeepSeek}
              className="tab-prompt-ai-action-btn"
              style={{ borderColor: "#2563eb", color: "#2563eb", background: "transparent" }}
            >
              Open in DeepSeek
            </button>
            <button
              type="button"
              onClick={copyToClipboard}
              className="tab-prompt-ai-action-btn tab-prompt-ai-action-btn--grid-singleton"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            >
              Copy prompt
            </button>
          </div>
          <TabPromptApiButtons
            userPrompt={prompt}
            onResult={() => {
              setClipboardFailed(false);
            }}
            persistAfterResult={async (text) => {
              const trimmed = text.trim();
              if (!safeTicker) return;
              const ok = await saveToServer(safeTicker, "credit-timeline", trimmed);
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
          {clipboardFailed && prompt && (
            <p className="text-[10px] mt-1" style={{ color: "var(--muted2)" }}>
              Select the prompt above and copy manually (Ctrl+C / Cmd+C).
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

