"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { signOut, useSession } from "next-auth/react";

import { EggHocCommitteeMark } from "./EggHocCommitteeMark";
import { LOGO_MARK_CELL_BG } from "./logoMarkCellStyle";
import { OreoSablePlay } from "./OreoSablePlay";
import { useUserPreferencesOptional } from "@/components/UserPreferencesProvider";
import { useUserSettingsModal } from "@/components/layout/UserSettingsModalProvider";

const accent = { color: "var(--accent)" } as const;

const SUBSTACK_URL = "https://yummycenturyegg.substack.com";
const EASTER_EGG_IMG = "/logo-easter-egg.png";
/** Century egg photo used as the “o” in the header mark. */
const CENTURY_EGG_MARK = "/century-egg-mark.png";

/** Approximate hit area on the photo (feces ~ lower-left); tweak % if needed. */
const POOP_HOTSPOT = {
  bottom: "22%",
  left: "8%",
  width: "min(28vw, 160px)",
  height: "min(20vh, 120px)",
} as const;

const OREO_EGG_HISTORY_KEY = "oreoEasterEgg" as const;

function OrganizedResearchTagline({ className }: { className?: string }) {
  return (
    <span className={className} style={{ color: "var(--text)" }}>
      <span style={accent}>O</span>rganized <span style={accent}>R</span>esearch, <span style={accent}>E</span>xposure &{" "}
      <span style={accent}>O</span>utlook
    </span>
  );
}

type Mode = "co" | "pm";

const NAV_BADGE_POLL_MS = 10_000;

export function TopNav({
  mode,
  onModeChange,
  onOpenEggHocCommittee,
  onOpenDailyNews,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  onOpenEggHocCommittee: () => void;
  onOpenDailyNews: () => void;
}) {
  const { data: session, status } = useSession();
  const prefs = useUserPreferencesOptional();
  const chatDisplayId = prefs?.preferences.profile?.chatDisplayId?.trim() || "";
  const [eggHocUnreadTotal, setEggHocUnreadTotal] = useState(0);
  const [dailyNewsUnread, setDailyNewsUnread] = useState(0);
  const [dogOverlay, setDogOverlay] = useState(false);
  const [browserBackReturnHint, setBrowserBackReturnHint] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const { openSettings } = useUserSettingsModal();
  const closingViaDooDooRef = useRef(false);
  const dogOverlayRef = useRef(false);

  useEffect(() => {
    dogOverlayRef.current = dogOverlay;
  }, [dogOverlay]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (status !== "authenticated") {
      setEggHocUnreadTotal(0);
      return;
    }

    const refreshBadges = async () => {
      try {
        const res = await fetch("/api/egg-hoc/conversations");
        const data = (await res.json()) as { conversations?: Array<{ unreadCount?: number }> };
        if (res.ok && Array.isArray(data.conversations)) {
          const sum = data.conversations.reduce((acc, c) => acc + (typeof c.unreadCount === "number" ? c.unreadCount : 0), 0);
          setEggHocUnreadTotal(sum);
        }
      } catch {
        /* ignore */
      }
    };

    void refreshBadges();
    const id = window.setInterval(() => void refreshBadges(), NAV_BADGE_POLL_MS);
    const onFocus = () => void refreshBadges();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") {
      setDailyNewsUnread(0);
      return;
    }
    const refreshDailyNewsBadge = async () => {
      try {
        const res = await fetch("/api/daily-news?lite=1");
        const text = await res.text();
        if (!text.trim()) return;
        const data = JSON.parse(text) as { unreadCount?: number };
        if (res.ok && typeof data.unreadCount === "number") {
          setDailyNewsUnread(data.unreadCount);
        }
      } catch {
        /* ignore */
      }
    };
    void refreshDailyNewsBadge();
    const id = window.setInterval(() => void refreshDailyNewsBadge(), NAV_BADGE_POLL_MS);
    const onRead = () => void refreshDailyNewsBadge();
    window.addEventListener("daily-news-read", onRead);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("daily-news-read", onRead);
    };
  }, [status]);

  useEffect(() => {
    const onPopState = () => {
      if (closingViaDooDooRef.current) {
        closingViaDooDooRef.current = false;
        return;
      }
      if (!dogOverlayRef.current) return;
      if (typeof window === "undefined") return;
      window.history.pushState({ [OREO_EGG_HISTORY_KEY]: true }, "", window.location.href);
      setBrowserBackReturnHint(true);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!dogOverlay) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [dogOverlay]);

  function openDogOverlayFromLogo() {
    setBrowserBackReturnHint(false);
    setDogOverlay(true);
    if (typeof window !== "undefined") {
      window.history.pushState({ [OREO_EGG_HISTORY_KEY]: true }, "", window.location.href);
    }
  }

  function closeDogOverlayViaDooDoo() {
    closingViaDooDooRef.current = true;
    setDogOverlay(false);
    setBrowserBackReturnHint(false);
    if (typeof window !== "undefined") {
      window.history.back();
    }
  }

  return (
    <header
      className="grid w-full flex-shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b px-4 py-2 sm:gap-3 sm:px-6 sm:py-2"
      style={{ background: "var(--sb)", borderColor: "var(--border)" }}
    >
      <div className="grid min-w-0 max-w-[min(100%,24rem)] grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_auto_auto] justify-self-start gap-x-2.5 gap-y-0.5 sm:max-w-[min(100%,26rem)] sm:gap-x-3 sm:gap-y-1">
        <button
          type="button"
          className="col-start-1 row-span-3 row-start-1 grid size-[3.75rem] shrink-0 cursor-pointer place-items-center place-self-center overflow-hidden border-0 p-1 sm:size-[4.25rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          style={LOGO_MARK_CELL_BG}
          onClick={openDogOverlayFromLogo}
          aria-label="OREO mark"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- static asset from /public */}
          <img
            src={CENTURY_EGG_MARK}
            alt=""
            className="h-full w-full object-contain object-center mix-blend-multiply contrast-[1.08]"
            draggable={false}
          />
        </button>
        <div className="col-start-2 row-start-1 flex min-w-0 flex-col gap-1 self-start leading-tight sm:gap-1.5">
          <span className="text-sm font-bold tracking-tight sm:text-base" style={{ color: "var(--text)" }}>
            OREO
          </span>
          <div className="h-px w-full max-w-[min(100vw-8rem,20rem)] shrink-0" style={{ background: "var(--accent)" }} />
        </div>
        <div className="col-start-2 row-start-2 min-w-0 self-start">
          <OrganizedResearchTagline className="max-w-[min(100vw-8rem,20rem)] text-[9px] font-normal leading-snug sm:text-[10px]" />
        </div>
        <div className="col-start-2 row-start-3 min-w-0 self-start text-[8px] font-medium leading-snug sm:text-[9px]" style={{ color: "var(--muted)" }}>
          powered by{" "}
          <a
            href={SUBSTACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-[var(--muted)] underline-offset-1 hover:opacity-90"
            style={{ color: "inherit" }}
          >
            CenturyEggCredit
          </a>
        </div>
      </div>
      <nav className="flex min-h-9 items-center justify-center gap-0.5 justify-self-center self-center sm:min-h-10 sm:gap-1" aria-label="Main mode">
        <button
          type="button"
          onClick={() => onModeChange("co")}
          className={`tab-bar-item ${mode === "co" ? "active" : ""}`}
        >
          Company Analysis
        </button>
        <button
          type="button"
          onClick={() => onModeChange("pm")}
          className={`tab-bar-item ${mode === "pm" ? "active" : ""}`}
        >
          PM Dashboard
        </button>
      </nav>
      <div className="flex min-w-0 flex-col items-end justify-end gap-1.5 sm:gap-2">
        {status === "authenticated" && session?.user && (
          <div
            className="flex max-w-full items-center gap-2 text-[10px] sm:text-[11px]"
            style={{ color: "var(--muted)" }}
          >
            <span className="max-w-[10rem] truncate sm:max-w-[14rem]" title={session.user.email ?? undefined}>
              {chatDisplayId || session.user.email || session.user.name || session.user.id}
            </span>
            <button
              type="button"
              className="shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium sm:text-[11px]"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
              onClick={() => openSettings()}
            >
              Settings
            </button>
            <button
              type="button"
              className="shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium sm:text-[11px]"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
              onClick={() => void signOut({ callbackUrl: "/login" })}
            >
              Sign out
            </button>
          </div>
        )}
        <div className="grid w-full min-w-0 max-w-[min(100%,24rem)] grid-cols-2 gap-1.5 sm:max-w-[28rem] sm:gap-2">
          <button
            type="button"
            className="btn-shell hi relative flex min-h-9 w-full min-w-0 items-center justify-center gap-1 px-1 text-[10px] sm:min-h-10 sm:gap-1.5 sm:px-2 sm:text-[11px]"
            onClick={onOpenDailyNews}
            aria-label={dailyNewsUnread > 0 ? `Daily News (${dailyNewsUnread} unread)` : "Daily News"}
          >
            {dailyNewsUnread > 0 ? (
              <span
                className="absolute -right-0.5 -top-0.5 flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-[var(--sb)]"
                aria-hidden
              >
                {dailyNewsUnread > 99 ? "99+" : dailyNewsUnread}
              </span>
            ) : null}
            <span className="min-w-0 text-center leading-tight">Daily News</span>
          </button>
          <button
            type="button"
            className="btn-shell hi relative flex min-h-9 w-full min-w-0 items-center justify-center gap-1.5 text-[11px] sm:min-h-10 sm:text-xs"
            onClick={onOpenEggHocCommittee}
            aria-label={
              eggHocUnreadTotal > 0 ? `Egg-Hoc Committee Chat (${eggHocUnreadTotal} unread)` : "Egg-Hoc Committee Chat"
            }
          >
            {eggHocUnreadTotal > 0 ? (
              <span
                className="absolute -right-0.5 -top-0.5 flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-[var(--sb)]"
                aria-hidden
              >
                {eggHocUnreadTotal > 99 ? "99+" : eggHocUnreadTotal}
              </span>
            ) : null}
            <EggHocCommitteeMark preset="nav" />
            <span className="min-w-0 max-sm:truncate text-center leading-tight sm:whitespace-normal">
              Egg-Hoc Committee Chat
            </span>
          </button>
        </div>
      </div>
      {portalReady &&
        dogOverlay &&
        createPortal(
          <div
            className="fixed inset-0 z-[99999] overflow-y-auto overflow-x-hidden bg-black"
            role="dialog"
            aria-modal="true"
            aria-labelledby="oreo-easter-egg-title"
          >
            {browserBackReturnHint && (
              <div
                className="sticky top-0 z-10 border-b px-4 py-3 text-center text-sm shadow-lg sm:text-base"
                style={{
                  background: "rgba(0,0,0,0.92)",
                  borderColor: "var(--accent)",
                  color: "var(--accent)",
                }}
                role="status"
              >
                You used the browser Back button. This screen stays open until you return the way{" "}
                <span className="font-semibold">OREO</span> intended: pick up the <span className="font-semibold">doo doo</span>{" "}
                in the lower area of her photo to go back to the homepage.
              </div>
            )}
            <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[minmax(200px,280px)_minmax(0,1fr)] lg:gap-10 lg:px-8">
              <aside className="flex flex-col items-center gap-4 text-center lg:sticky lg:top-6 lg:items-stretch lg:self-start lg:text-left">
                <div>
                  <h2
                    id="oreo-easter-egg-title"
                    className="text-lg font-bold tracking-tight text-white sm:text-xl"
                    style={{ color: "var(--accent)" }}
                  >
                    Why OREO?
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/90 sm:text-base">
                    Because she loves to play fetch, and because she doesn&apos;t listen most of the time.
                  </p>
                </div>
                <div className="relative mx-auto w-full max-w-[min(100%,280px)]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- dynamic asset, no optimization required */}
                  <img
                    src={EASTER_EGG_IMG}
                    alt=""
                    className="block h-auto w-full max-h-[min(48dvh,420px)] object-contain object-center lg:max-h-[min(70dvh,560px)]"
                    draggable={false}
                  />
                  <button
                    type="button"
                    className="absolute border-0 bg-transparent p-0 outline-none ring-0"
                    style={{
                      bottom: POOP_HOTSPOT.bottom,
                      left: POOP_HOTSPOT.left,
                      width: POOP_HOTSPOT.width,
                      height: POOP_HOTSPOT.height,
                      cursor: "url(/cursors/poop-bag-cursor.svg) 16 8, pointer",
                    }}
                    onClick={closeDogOverlayViaDooDoo}
                    aria-label="Pick up the doo doo and return to the app"
                  />
                </div>
              </aside>
              <div className="min-w-0 border-t border-white/10 pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
                <OreoSablePlay />
              </div>
            </div>
          </div>,
          document.body
        )}
    </header>
  );
}
