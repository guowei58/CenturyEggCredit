import Link from "next/link";
import Image from "next/image";
import { ScreenshotCarousel } from "@/components/marketing/ScreenshotCarousel";
import { LOGO_MARK_CELL_BG } from "@/components/layout/logoMarkCellStyle";

export function LandingPage() {
  // Cache-bust screenshots so replacing files under /public takes effect immediately in dev/prod browsers.
  // (Some browsers aggressively cache static PNGs even after refresh.)
  const v = Date.now();
  const shots = [
    { src: `/oreo-screens/tour-1.png?v=${v}`, alt: "Company workflow: public records profile + research organization" },
    { src: `/oreo-screens/tour-2.png?v=${v}`, alt: "Capital structure + entity mapping workflows" },
    { src: `/oreo-screens/tour-3.png?v=${v}`, alt: "Historical financial statements + analysis workspace" },
  ] as const;

  return (
    <div
      className="h-[100dvh] overflow-y-auto"
      style={{ background: "var(--bg)", color: "var(--text)", WebkitOverflowScrolling: "touch" }}
    >
      <header className="mx-auto w-full max-w-6xl px-6 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex items-center gap-4 rounded-xl border px-4 py-3"
            style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--card2) 35%, var(--card))" }}
          >
            <div
              className="relative grid size-[4.5rem] shrink-0 place-items-center overflow-hidden border-0 p-1 sm:size-[5rem]"
              style={LOGO_MARK_CELL_BG}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- match main app header mark */}
              <img
                src="/century-egg-mark.png"
                alt="OREO"
                className="h-full w-full object-contain object-center mix-blend-multiply contrast-[1.08]"
                draggable={false}
              />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-wide text-[var(--text)]">OREO</div>
              <div className="mt-1 h-px w-44" style={{ background: "color-mix(in srgb, var(--accent) 55%, var(--border))" }} />
              <div className="mt-1 text-[12px]" style={{ color: "var(--muted2)" }}>
                <span style={{ color: "var(--accent)" }}>O</span>rganized{" "}
                <span style={{ color: "var(--accent)" }}>R</span>esearch,{" "}
                <span style={{ color: "var(--accent)" }}>E</span>xposure &amp;{" "}
                <span style={{ color: "var(--accent)" }}>O</span>utlook
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-md border px-3 py-2 text-xs font-semibold"
              style={{
                borderColor: "var(--border2)",
                background: "color-mix(in srgb, var(--card2) 60%, var(--card))",
                color: "var(--text)",
              }}
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded-md px-3 py-2 text-xs font-semibold"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              Create free account
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-16 sm:px-8">
        <section className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-stretch">
          <div className="space-y-6 lg:flex lg:h-full lg:flex-col">
            <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted2)" }}>
              <span>Free</span>
              <span style={{ opacity: 0.6 }}>·</span>
              <span>Built for credit analysts</span>
            </div>
            <h1 className="text-balance text-3xl font-semibold leading-tight sm:text-4xl">
              OREO is{" "}
              <span style={{ color: "var(--accent)" }}>O</span>rganized{" "}
              <span style={{ color: "var(--accent)" }}>R</span>esearch,{" "}
              <span style={{ color: "var(--accent)" }}>E</span>xposure and{" "}
              <span style={{ color: "var(--accent)" }}>O</span>utlook for credit analysts.
            </h1>
            <p className="max-w-prose text-pretty text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              A free, AI‑driven workflow that takes you from industry and business analysis to document retrieval/archival, capital
              structure and financial analysis, and finally memo or slide deck preparation—without losing sources, context, or
              version history.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 sm:items-stretch">
              <div className="h-full rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                  Research, organized end‑to‑end
                </div>
                <div className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>
                  Keep your workflow coherent across sections—industry, business, documents, financials, cap structure, and outputs.
                </div>
              </div>
              <div className="h-full rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                  AI‑assisted, analyst‑controlled
                </div>
                <div className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>
                  Use AI where it helps (summaries, extraction, drafting) while keeping sources and reasoning reviewable.
                </div>
              </div>
            </div>
          </div>

          <div className="h-full rounded-2xl border p-4 sm:p-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--muted2)" }}>
              What you get
            </div>
            <ul className="mt-3 space-y-2 text-sm" style={{ color: "var(--muted)" }}>
              <li>Consistent AI-prompts and AI-driven workflow</li>
              <li>Industry & company research sections</li>
              <li>Document retrieval and archival</li>
              <li>Easy access to regulatory filings</li>
              <li>Capital structure analysis + key exhibits</li>
              <li>Liability management analysis</li>
              <li>Entity mapper for subsidiaries</li>
              <li>Historical financial statements</li>
              <li>Daily news updates on your tickers</li>
              <li>Chats with your pari-passu pals</li>
              <li>AI‑assisted memo and slide deck preparation</li>
              <li>Export “Download All Data” ZIP</li>
              <li>Literary and biblical references for your credit analysis</li>
              <li>Eternal life through the mercy, grace, and redeeming love of God.</li>
            </ul>
          </div>
        </section>

        <section className="mt-12">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold">A quick look inside OREO</h2>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              Screens shown are from the live platform UI.
            </div>
          </div>
          <div className="mt-4">
            <ScreenshotCarousel shots={[...shots]} />
          </div>
        </section>

        <section className="mt-12 rounded-2xl border p-6 sm:p-7" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold">Ready to try it?</div>
              <div className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                Create a free account and start organizing your credit research today.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/register"
                className="rounded-md px-4 py-2 text-sm font-semibold"
                style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
              >
                Create free account
              </Link>
              <Link
                href="/login"
                className="rounded-md border px-4 py-2 text-sm font-semibold"
                style={{
                  borderColor: "var(--border2)",
                  background: "color-mix(in srgb, var(--card2) 55%, var(--card))",
                  color: "var(--text)",
                }}
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 pb-10 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3 text-[11px]" style={{ color: "var(--muted)" }}>
          <span>© {new Date().getFullYear()} CenturyEggCredit</span>
          <span>
            OREO is <span style={{ color: "var(--accent)" }}>O</span>rganized{" "}
            <span style={{ color: "var(--accent)" }}>R</span>esearch,{" "}
            <span style={{ color: "var(--accent)" }}>E</span>xposure and{" "}
            <span style={{ color: "var(--accent)" }}>O</span>utlook — not legal advice.
          </span>
        </div>
      </footer>
    </div>
  );
}

