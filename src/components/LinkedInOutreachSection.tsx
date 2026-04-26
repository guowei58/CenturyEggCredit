"use client";

import type { Dispatch, SetStateAction } from "react";
import {
  OUTREACH_LETTER_TEMPLATE,
  type LinkedInOutreachState,
} from "@/lib/linkedin-outreach";

type TabContext = "employee" | "industry";

const OUTREACH_FIELD_PLACEHOLDER = "Enter your information";

export function LinkedInOutreachSection({
  headingId,
  outreachSig,
  setOutreachSig,
  tabContext,
}: {
  headingId: string;
  outreachSig: LinkedInOutreachState;
  setOutreachSig: Dispatch<SetStateAction<LinkedInOutreachState>>;
  tabContext: TabContext;
}) {
  const tablePhrase =
    tabContext === "employee"
      ? "saved employee contacts table"
      : "saved industry contacts table";

  return (
    <section
      className="mt-10 border-t pt-8"
      style={{ borderColor: "var(--border2)" }}
      aria-labelledby={headingId}
    >
      <h2
        id={headingId}
        className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]"
        style={{ color: "var(--muted)" }}
      >
        LinkedIn outreach letter
      </h2>
      <p className="mb-4 max-w-3xl text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
        Edit the letter below; your text, signature fields, and research line are{" "}
        <strong style={{ color: "var(--text)" }}>saved in this browser</strong> and reused for{" "}
        <strong style={{ color: "var(--text)" }}>every company and ticker</strong> until you change them again. In the {tablePhrase}{" "}
        above, use <strong style={{ color: "var(--text)" }}>Message in Linkedin</strong> next to each profile link to open a draft
        window — copy the text and paste it into LinkedIn (LinkedIn does not allow external sites to pre-fill the compose box).
      </p>

      <label className="mb-2 block max-w-3xl text-xs font-medium" style={{ color: "var(--muted2)" }}>
        Letter template
        <span className="mt-1 block font-normal leading-snug opacity-90">
          Placeholders:{" "}
          <code className="text-[10px]" style={{ color: "var(--muted)" }}>
            [Name]
          </code>{" "}
          (first name),{" "}
          <code className="text-[10px]" style={{ color: "var(--muted)" }}>
            [Company]
          </code>
          ,{" "}
          <code className="text-[10px]" style={{ color: "var(--muted)" }}>
            [function/business area]
          </code>
          ,{" "}
          <code className="text-[10px]" style={{ color: "var(--muted)" }}>
            [industry / company / market]
          </code>
          ,{" "}
          <code className="text-[10px]" style={{ color: "var(--muted)" }}>
            [Your Name]
          </code>
          ,{" "}
          <code className="text-[10px]" style={{ color: "var(--muted)" }}>
            [Title / Firm, if applicable]
          </code>
          ,{" "}
          <code className="text-[10px]" style={{ color: "var(--muted)" }}>
            [Email]
          </code>
          ,{" "}
          <code className="text-[10px]" style={{ color: "var(--muted)" }}>
            [Phone]
          </code>
        </span>
        <textarea
          value={outreachSig.letterTemplate}
          onChange={(e) => setOutreachSig((s) => ({ ...s, letterTemplate: e.target.value }))}
          spellCheck
          className="mt-2 min-h-[280px] w-full resize-y rounded-lg border px-3 py-3 font-sans text-[13px] leading-relaxed focus:border-[var(--accent)] focus:outline-none"
          style={{
            borderColor: "var(--border2)",
            background: "var(--card2)",
            color: "var(--text)",
          }}
          aria-label="LinkedIn outreach letter template"
        />
      </label>
      <button
        type="button"
        className="mb-6 rounded border px-3 py-1.5 text-xs font-medium"
        style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
        onClick={() =>
          setOutreachSig((s) => ({
            ...s,
            letterTemplate: OUTREACH_LETTER_TEMPLATE,
          }))
        }
      >
        Reset letter to default
      </button>

      <div className="mt-6 grid max-w-3xl gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-xs font-medium" style={{ color: "var(--muted2)" }}>
          Research project line
          <span className="font-normal opacity-90">Replaces [industry / company / market]</span>
          <input
            type="text"
            value={outreachSig.marketLine}
            onChange={(e) => setOutreachSig((s) => ({ ...s, marketLine: e.target.value }))}
            placeholder={OUTREACH_FIELD_PLACEHOLDER}
            className="rounded border px-3 py-2 text-sm font-normal"
            style={{
              borderColor: "var(--border2)",
              background: "var(--card)",
              color: "var(--text)",
            }}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium" style={{ color: "var(--muted2)" }}>
          Your name
          <span className="font-normal opacity-90">Replaces [Your Name]</span>
          <input
            type="text"
            value={outreachSig.yourName}
            onChange={(e) => setOutreachSig((s) => ({ ...s, yourName: e.target.value }))}
            placeholder={OUTREACH_FIELD_PLACEHOLDER}
            className="rounded border px-3 py-2 text-sm font-normal"
            style={{
              borderColor: "var(--border2)",
              background: "var(--card)",
              color: "var(--text)",
            }}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium sm:col-span-2" style={{ color: "var(--muted2)" }}>
          Title / firm (optional)
          <input
            type="text"
            value={outreachSig.yourTitle}
            onChange={(e) => setOutreachSig((s) => ({ ...s, yourTitle: e.target.value }))}
            placeholder={OUTREACH_FIELD_PLACEHOLDER}
            className="rounded border px-3 py-2 text-sm font-normal"
            style={{
              borderColor: "var(--border2)",
              background: "var(--card)",
              color: "var(--text)",
            }}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium" style={{ color: "var(--muted2)" }}>
          Email
          <input
            type="email"
            autoComplete="email"
            value={outreachSig.yourEmail}
            onChange={(e) => setOutreachSig((s) => ({ ...s, yourEmail: e.target.value }))}
            placeholder={OUTREACH_FIELD_PLACEHOLDER}
            className="rounded border px-3 py-2 text-sm font-normal"
            style={{
              borderColor: "var(--border2)",
              background: "var(--card)",
              color: "var(--text)",
            }}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium" style={{ color: "var(--muted2)" }}>
          Phone
          <input
            type="tel"
            autoComplete="tel"
            value={outreachSig.yourPhone}
            onChange={(e) => setOutreachSig((s) => ({ ...s, yourPhone: e.target.value }))}
            placeholder={OUTREACH_FIELD_PLACEHOLDER}
            className="rounded border px-3 py-2 text-sm font-normal"
            style={{
              borderColor: "var(--border2)",
              background: "var(--card)",
              color: "var(--text)",
            }}
          />
        </label>
      </div>
    </section>
  );
}
