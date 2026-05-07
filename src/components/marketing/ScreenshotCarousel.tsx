"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Shot = { src: string; alt: string };

export function ScreenshotCarousel({ shots }: { shots: Shot[] }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [modalIdx, setModalIdx] = useState<number | null>(null);

  const safeShots = useMemo(() => shots.filter((s) => s && s.src && s.alt), [shots]);

  const scrollToIndex = useCallback((idx: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(idx, safeShots.length - 1));
    const child = el.children.item(clamped) as HTMLElement | null;
    if (!child) return;
    child.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }, [safeShots.length]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const w = el.clientWidth || 1;
      const next = Math.round(el.scrollLeft / w);
      setActive(Math.max(0, Math.min(next, safeShots.length - 1)));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [safeShots.length]);

  useEffect(() => {
    if (modalIdx == null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalIdx(null);
      if (e.key === "ArrowLeft") setModalIdx((v) => (v == null ? v : Math.max(0, v - 1)));
      if (e.key === "ArrowRight") setModalIdx((v) => (v == null ? v : Math.min(safeShots.length - 1, v + 1)));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalIdx, safeShots.length]);

  if (safeShots.length === 0) return null;

  const modalShot = modalIdx != null ? safeShots[modalIdx] : null;
  const modalHasPrev = modalIdx != null && modalIdx > 0;
  const modalHasNext = modalIdx != null && modalIdx < safeShots.length - 1;

  return (
    <div className="rounded-2xl border p-3 sm:p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="relative">
        <div
          ref={scrollerRef}
          className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {safeShots.map((s, idx) => (
            <div key={s.src} className="w-full shrink-0 snap-start px-1">
              <button
                type="button"
                className="w-full overflow-hidden rounded-xl border text-left"
                style={{ borderColor: "var(--border2)" }}
                onClick={() => setModalIdx(idx)}
                aria-label={`Expand screenshot: ${s.alt}`}
              >
                {/* Use a plain <img> so the browser always renders the original pixels (no srcset/sizes). */}
                {/* eslint-disable-next-line @next/next/no-img-element -- static assets under /public */}
                <div className="flex justify-center">
                  <img
                    src={s.src}
                    alt={s.alt}
                    loading="lazy"
                    decoding="async"
                    className="block h-auto max-w-full cursor-zoom-in"
                    style={{
                      maxHeight: "70vh",
                      width: "auto",
                      objectFit: "contain",
                    }}
                  />
                </div>
              </button>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[12px]" style={{ color: "var(--muted)" }}>
                <span>{s.alt}</span>
              </div>
            </div>
          ))}
        </div>

        {safeShots.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => scrollToIndex(active - 1)}
              disabled={active <= 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-md border px-2 py-1 text-xs font-semibold disabled:opacity-40"
              style={{
                borderColor: "var(--border2)",
                background: "color-mix(in srgb, var(--card2) 70%, var(--card))",
                color: "var(--text)",
              }}
              aria-label="Previous screenshot"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => scrollToIndex(active + 1)}
              disabled={active >= safeShots.length - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border px-2 py-1 text-xs font-semibold disabled:opacity-40"
              style={{
                borderColor: "var(--border2)",
                background: "color-mix(in srgb, var(--card2) 70%, var(--card))",
                color: "var(--text)",
              }}
              aria-label="Next screenshot"
            >
              Next
            </button>
          </>
        ) : null}
      </div>

      {safeShots.length > 1 ? (
        <div className="mt-3 flex items-center justify-center gap-2">
          {safeShots.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => scrollToIndex(i)}
              className="h-2.5 w-2.5 rounded-full border"
              style={{
                borderColor: "var(--border2)",
                background: i === active ? "var(--accent)" : "transparent",
              }}
              aria-label={`Go to screenshot ${i + 1}`}
            />
          ))}
        </div>
      ) : null}

      {modalShot ? (
        <div
          className="fixed inset-0 z-[10060] flex items-center justify-center px-3 py-6"
          style={{ background: "rgba(0,0,0,0.65)" }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalIdx(null);
          }}
        >
          <div
            className="h-[96vh] w-[98vw] max-w-[1600px] overflow-hidden rounded-2xl border"
            style={{ borderColor: "var(--border2)", background: "var(--card)" }}
            role="dialog"
            aria-label={modalShot.alt}
          >
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <div className="min-w-0 truncate text-xs font-semibold" style={{ color: "var(--text)" }}>
                {modalShot.alt}
              </div>
              <div className="flex items-center gap-2">
                {safeShots.length > 1 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setModalIdx((v) => (v == null ? v : Math.max(0, v - 1)))}
                      disabled={!modalHasPrev}
                      className="rounded-md border px-2 py-1 text-xs font-semibold disabled:opacity-40"
                      style={{
                        borderColor: "var(--border2)",
                        background: "color-mix(in srgb, var(--card2) 70%, var(--card))",
                        color: "var(--text)",
                      }}
                      aria-label="Previous screenshot"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalIdx((v) => (v == null ? v : Math.min(safeShots.length - 1, v + 1)))}
                      disabled={!modalHasNext}
                      className="rounded-md border px-2 py-1 text-xs font-semibold disabled:opacity-40"
                      style={{
                        borderColor: "var(--border2)",
                        background: "color-mix(in srgb, var(--card2) 70%, var(--card))",
                        color: "var(--text)",
                      }}
                      aria-label="Next screenshot"
                    >
                      Next
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => setModalIdx(null)}
                  className="rounded-md border px-2 py-1 text-xs font-semibold"
                  style={{
                    borderColor: "var(--border2)",
                    background: "color-mix(in srgb, var(--card2) 70%, var(--card))",
                    color: "var(--text)",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="h-[calc(96vh-3.25rem)] overflow-auto p-2 sm:p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- static assets under /public */}
              <div className="flex justify-center">
                <img
                  src={modalShot.src}
                  alt={modalShot.alt}
                  className="block h-auto max-w-full cursor-zoom-out"
                  style={{ maxHeight: "100%", width: "auto", objectFit: "contain" }}
                  onClick={() => setModalIdx(null)}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

