"use client";

import { EggHocCommitteeMark } from "./EggHocCommitteeMark";

/**
 * Peer-to-peer chat shell for other OREO users ("Pari Passu Pals").
 * Real-time backend not wired yet — UI placeholder for future rooms/DMs.
 */

export function EggHocCommitteeDrawer({
  open,
  onOpen,
  onClose,
  ticker,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  ticker?: string | null;
}) {
  const sym = ticker?.trim().toUpperCase() ?? "";

  return (
    <>
      <div
        className="fixed bottom-0 right-0 z-[199] flex h-full w-[min(100vw,420px)] flex-col border-l transition-transform duration-200 ease-out"
        style={{
          background: "var(--panel)",
          borderColor: "var(--border)",
          transform: open ? "translateX(0)" : "translateX(100%)",
        }}
      >
        <div
          className="flex flex-shrink-0 items-center gap-3 border-b px-5 py-4"
          style={{ background: "var(--sb)", borderColor: "var(--border)" }}
        >
          <EggHocCommitteeMark preset="drawerHeader" className="self-center" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold tracking-tight" style={{ color: "var(--text)" }}>
              Egg-Hoc Committee Chat
            </div>
            <div className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>
              Peer chat with <span className="font-semibold" style={{ color: "var(--accent)" }}>Pari Passu Pals</span> — other
              people using OREO (not AI).
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 rounded-md p-1.5 transition-colors hover:bg-[var(--card)]"
            style={{ color: "var(--muted2)" }}
            aria-label="Close Egg-Hoc Committee Chat"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div
            className="rounded-lg border p-4 text-sm leading-relaxed"
            style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--text)" }}
          >
            <p className="font-medium" style={{ color: "var(--accent)" }}>
              Coming soon
            </p>
            <p className="mt-2">
              This panel will host live conversation with other OREO users — your <strong>Pari Passu Pals</strong> — for
              committee-style discussion, shared work, and coordination.
            </p>
            <p className="mt-2 text-[13px]" style={{ color: "var(--muted2)" }}>
              Server-backed rooms, presence, and message sync are not connected in this build. When they are, you&apos;ll open the
              same drawer to message peers; <strong>AI Chat</strong> stays separate for talking to Claude or ChatGPT only.
            </p>
            {sym ? (
              <p className="mt-3 text-[12px]" style={{ color: "var(--muted)" }}>
                Sidebar ticker <span className="font-mono">{sym}</span> may be used later for ticker-scoped channels.
              </p>
            ) : null}
          </div>
        </div>

        <div
          className="flex flex-shrink-0 flex-col gap-2 border-t p-4"
          style={{ background: "var(--sb)", borderColor: "var(--border)" }}
        >
          <textarea
            rows={2}
            placeholder="Peer messages will appear here when Egg-Hoc Committee Chat is live."
            className="min-h-[44px] w-full resize-y rounded-lg border bg-[var(--card)] px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--muted)] opacity-70"
            style={{ borderColor: "var(--border2)" }}
            disabled
          />
          <p className="text-[9px] leading-snug" style={{ color: "var(--muted2)" }}>
            Use <strong>AI Chat</strong> (robot button below) for model-backed answers about credit and your saved OREO data.
          </p>
        </div>
      </div>
    </>
  );
}
