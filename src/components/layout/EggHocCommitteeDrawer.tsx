"use client";

import { useEffect } from "react";
import { EggHocCommitteeChat } from "@/components/egg-hoc/EggHocCommitteeChat";
import { EggHocCommitteeMark } from "./EggHocCommitteeMark";
import { unlockEggHocNotificationAudio } from "@/lib/sounds/playEggHocBark";

/**
 * Peer-to-peer chat with other OREO users ("Pari Passu Pals").
 * Server-backed DMs and groups; list polling + thread refresh (real-time optional later).
 */

export function EggHocCommitteeDrawer({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (open) unlockEggHocNotificationAudio();
  }, [open]);

  return (
    <>
      <div
        className="fixed bottom-0 right-0 z-[199] flex h-full w-[min(100vw,640px)] flex-col border-l transition-transform duration-200 ease-out"
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
              Message <span className="font-semibold" style={{ color: "var(--accent)" }}>Pari Passu Pals</span> — other OREO users
              (not the AI chat).
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

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <EggHocCommitteeChat />
        </div>
      </div>
    </>
  );
}
