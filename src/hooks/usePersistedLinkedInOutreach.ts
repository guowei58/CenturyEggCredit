"use client";

import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import {
  DEFAULT_LINKEDIN_OUTREACH_STATE,
  OUTREACH_STORAGE_KEY,
  type LinkedInOutreachState,
} from "@/lib/linkedin-outreach";

export function usePersistedLinkedInOutreach(): {
  outreachSig: LinkedInOutreachState;
  setOutreachSig: Dispatch<SetStateAction<LinkedInOutreachState>>;
} {
  const [outreachSig, setOutreachSig] = useState<LinkedInOutreachState>(DEFAULT_LINKEDIN_OUTREACH_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(OUTREACH_STORAGE_KEY);
      if (raw) {
        const j = JSON.parse(raw) as Record<string, unknown>;
        setOutreachSig((prev) => ({
          letterTemplate:
            typeof j.letterTemplate === "string" ? j.letterTemplate : prev.letterTemplate,
          marketLine: typeof j.marketLine === "string" ? j.marketLine : prev.marketLine,
          yourName: typeof j.yourName === "string" ? j.yourName : prev.yourName,
          yourTitle: typeof j.yourTitle === "string" ? j.yourTitle : prev.yourTitle,
          yourEmail: typeof j.yourEmail === "string" ? j.yourEmail : prev.yourEmail,
          yourPhone: typeof j.yourPhone === "string" ? j.yourPhone : prev.yourPhone,
        }));
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      localStorage.setItem(OUTREACH_STORAGE_KEY, JSON.stringify(outreachSig));
    } catch {
      /* ignore */
    }
  }, [outreachSig, hydrated]);

  return { outreachSig, setOutreachSig };
}
