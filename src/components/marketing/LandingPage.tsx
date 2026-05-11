import Link from "next/link";
import { ScreenshotCarousel } from "@/components/marketing/ScreenshotCarousel";
import { LOGO_MARK_CELL_BG } from "@/components/layout/logoMarkCellStyle";

const heroValueCards = [
  {
    title: "Research, organized end-to-end",
    body:
      "Move from business overview to filings, debt documents, regulatory checks, financials, capital structure, and final output in one workflow.",
  },
  {
    title: "AI-assisted, analyst-controlled",
    body:
      "Use AI for summaries, extraction, comparison, and drafting while keeping source links and analyst judgment reviewable.",
  },
  {
    title: "Built for public-source diligence",
    body:
      "Combine SEC filings, company materials, credit documents, regulatory databases, public-record links, and saved analyst notes.",
  },
] as const;

const researchPacketPreviewItems = [
  "Business overview",
  "Filings & presentations",
  "Capital structure",
  "Debt documents",
  "Covenants & LMEs",
  "Entity map",
  "Regulatory / litigation links",
  "Memo or deck output",
] as const;

const workflowCards = [
  {
    title: "1. Start with a ticker",
    body:
      "Pull company filings, presentations, business descriptions, segment disclosures, management information, and recent events.",
  },
  {
    title: "2. Build the evidence file",
    body:
      "Organize SEC filings, investor decks, debt documents, regulatory filings, litigation links, UCC/state records, and saved documents by issuer.",
  },
  {
    title: "3. Analyze the capital structure",
    body:
      "Review debt stack, maturity schedule, key exhibits, guarantors, borrowers, restricted subsidiaries, covenants, and liability management risk.",
  },
  {
    title: "4. Export the work product",
    body:
      "Draft memos, research notes, slide decks, diligence checklists, and source-backed summaries for review.",
  },
] as const;

const analystWorkflowCards = [
  {
    title: "Credit analysts",
    body:
      "Find debt documents, maturity issues, covenant terms, guarantor structures, restricted subsidiary baskets, and potential liability-management angles faster.",
  },
  {
    title: "Equity analysts",
    body:
      "Add credit-style diligence to public-equity research with better visibility into leverage, liquidity, legal risk, regulatory exposure, and management history.",
  },
  {
    title: "Distressed & special situations",
    body:
      "Surface complex capital structures, entity-level issues, litigation, restructuring events, exchange offers, and hidden public-record risks.",
  },
  {
    title: "Private credit & lending diligence",
    body:
      "Use public filings, state links, UCC search paths, lien records, regulatory databases, and company materials as a diligence layer before deeper review.",
  },
  {
    title: "Independent writers & research publishers",
    body:
      "Build source-backed research notes, Substack drafts, public writeups, and structured company deep dives with citations and saved source files.",
  },
  {
    title: "Students & junior analysts",
    body:
      "Learn a professional research process for stock pitches, credit memos, CFA Research Challenge prep, investment clubs, and interview preparation.",
  },
] as const;

const coreModules = [
  {
    title: "Company overview",
    body: "Business description, segments, management, competitors, market structure, and first-pass research questions.",
  },
  {
    title: "Filings & presentations",
    body: "Retrieve, archive, search, and summarize SEC filings, investor presentations, earnings materials, and company documents.",
  },
  {
    title: "Capital structure",
    body: "Debt stack, maturity schedule, key exhibits, financial snapshots, and credit timeline.",
  },
  {
    title: "Debt documents",
    body: "Credit agreements, indentures, amendments, collateral documents, guarantees, joinders, intercreditor agreements, and related exhibits.",
  },
  {
    title: "Covenants & liability management",
    body: "AI-assisted review of restricted payments, debt capacity, liens, asset sales, investments, defaults, and priming / exchange risk.",
  },
  {
    title: "Entity mapper",
    body: "Identify borrowers, issuers, guarantors, restricted subsidiaries, unrestricted subsidiaries, non-guarantor restricted subs, and special-purpose entities.",
  },
  {
    title: "Regulatory records",
    body: "Access relevant agency data and filings across SEC, FCC, USPTO, FDA, EPA, OSHA, FERC, NHTSA, SAM.gov, and other public sources where available.",
  },
  {
    title: "Public-record diligence",
    body: "State-by-state links and workflows for secretary of state searches, UCC records, litigation, tax liens, county records, and other manual diligence sources.",
  },
  {
    title: "News & events",
    body: "Daily ticker updates, recent filings, press releases, earnings events, restructuring developments, and saved event history.",
  },
  {
    title: "Memo & deck preparation",
    body: "AI-assisted drafting for credit memos, equity research notes, IC summaries, diligence checklists, and slide decks.",
  },
  {
    title: "Saved document archive",
    body: "Store filings, PDFs, Excel files, presentations, credit documents, and generated outputs by ticker.",
  },
  {
    title: "Export / download all data",
    body: "Download research packets, saved documents, source files, and generated outputs for offline review.",
  },
] as const;

const sampleUseCases = [
  {
    title: "Distressed credit review",
    example: "LUMN, AMC, HTZ, BHC",
    body:
      "Build a capital-structure packet, retrieve debt docs, review maturities, identify covenant issues, and prepare a credit memo.",
    cta: "Build distressed credit packet",
  },
  {
    title: "Regulatory-heavy company review",
    example: "EchoStar, telecom, broadcasters, utilities",
    body:
      "Combine SEC filings with agency-level records, spectrum/regulatory documents, public proceedings, and event history.",
    cta: "Run regulatory workflow",
  },
  {
    title: "Hidden-risk scan",
    example: "Industrials, healthcare, consumer finance, energy",
    body:
      "Check litigation, enforcement actions, environmental records, licensing databases, public-record links, and state filings.",
    cta: "Run hidden-risk scan",
  },
  {
    title: "Student stock or credit pitch",
    example: "Any public-company ticker",
    body:
      "Generate a structured research starter pack for investment clubs, class projects, interview prep, or CFA Research Challenge work.",
    cta: "Create pitch packet",
  },
] as const;

function sectionEyebrow(label: string) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--accent)" }}>
      {label}
    </div>
  );
}

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
      className="h-[100dvh] overflow-y-auto tracking-normal"
      style={{
        background: "var(--bg)",
        color: "var(--text)",
        WebkitOverflowScrolling: "touch",
        fontSize: "14px",
        lineHeight: 1.6,
        letterSpacing: "normal",
        wordSpacing: "normal",
        wordBreak: "normal",
        overflowWrap: "normal",
        hyphens: "manual",
      }}
    >
      <header className="mx-auto w-full max-w-6xl px-6 py-4 sm:px-8 sm:py-5">
        <nav className="flex flex-wrap items-center justify-between gap-4" aria-label="Primary">
          <div
            className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
            style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--card2) 35%, var(--card))" }}
          >
            <div
              className="relative grid size-[3.6rem] shrink-0 place-items-center overflow-hidden border-0 p-1 sm:size-[4rem]"
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
              <div className="text-[13px] font-semibold text-[var(--text)]">OREO</div>
              <div className="mt-1 h-px w-36" style={{ background: "color-mix(in srgb, var(--accent) 55%, var(--border))" }} />
              <div className="mt-1 text-[12px]" style={{ color: "var(--muted2)" }}>
                <span style={{ color: "var(--accent)" }}>O</span>rganized{" "}
                <span style={{ color: "var(--accent)" }}>R</span>esearch,{" "}
                <span style={{ color: "var(--accent)" }}>E</span>xposure &amp;{" "}
                <span style={{ color: "var(--accent)" }}>O</span>utlook
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="hidden items-center gap-3 text-xs sm:flex" style={{ color: "var(--muted)", letterSpacing: "normal" }}>
              <a href="#workflows" className="transition-opacity hover:opacity-80">
                Workflows
              </a>
              <a href="#modules" className="transition-opacity hover:opacity-80">
                Modules
              </a>
              <a href="#examples" className="transition-opacity hover:opacity-80">
                Examples
              </a>
            </div>
            <Link
              href="/login"
              className="rounded-md border px-3 py-2 text-xs font-semibold tracking-normal"
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
              className="rounded-md px-3 py-2 text-xs font-semibold tracking-normal"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              Create account
            </Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-16 sm:px-8">
        <section className="grid gap-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:items-stretch">
          <div className="space-y-6 lg:flex lg:h-full lg:flex-col">
            <div
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-normal"
              style={{ borderColor: "var(--border)", color: "var(--muted2)" }}
            >
              <span>Free</span>
              <span style={{ opacity: 0.6 }}>·</span>
              <span>Built for credit, equity &amp; special situations analysts</span>
            </div>
            <h1 className="max-w-3xl text-3xl font-semibold leading-tight sm:text-5xl">
              OREO turns a ticker into a{" "}
              <span style={{ color: "var(--accent)" }}>source-backed research packet</span>.
            </h1>
            <p className="max-w-prose text-sm leading-relaxed tracking-normal" style={{ color: "var(--muted)" }}>
              An AI-driven workflow for organizing public-company research: filings, presentations, debt documents, capital
              structure, regulatory records, litigation and public-record links, and memo or deck preparation — without losing
              sources, context, or version history.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/register"
                className="rounded-md px-4 py-2.5 text-sm font-semibold tracking-normal"
                style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
              >
                Start research packet
              </Link>
              <a
                href="#examples"
                className="rounded-md border px-4 py-2.5 text-sm font-semibold tracking-normal"
                style={{
                  borderColor: "var(--border2)",
                  background: "color-mix(in srgb, var(--card2) 55%, var(--card))",
                  color: "var(--text)",
                }}
              >
                See sample workflow
              </a>
            </div>
            <p className="text-[12px] leading-relaxed tracking-normal" style={{ color: "var(--muted2)" }}>
              Free to use. No credit card required.
            </p>
            <form
              action="/register"
              method="get"
              className="rounded-2xl border p-4 sm:p-5"
              style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--card2) 32%, var(--card))" }}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }} htmlFor="landing-ticker">
                    Start with a ticker
                  </label>
                  <input
                    id="landing-ticker"
                    name="ticker"
                    type="text"
                    placeholder="Enter ticker, e.g. LUMN, AMC, HTZ"
                    className="w-full rounded-md border bg-[var(--card)] px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
                    style={{ borderColor: "var(--border2)" }}
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-md px-4 py-2.5 text-sm font-semibold tracking-normal"
                  style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                >
                  Generate research packet
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: "var(--muted2)" }}>
                <span>Try:</span>
                {["LUMN", "AMC", "HTZ", "SATS"].map((tk) => (
                  <Link key={tk} href={`/register?ticker=${encodeURIComponent(tk)}`} className="underline tracking-normal" style={{ color: "var(--accent)" }}>
                    {tk}
                  </Link>
                ))}
              </div>
            </form>
          </div>

          <div
            className="flex h-full flex-col rounded-2xl border p-5 sm:p-6"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--muted2)" }}>
              Research packet preview
            </div>
            <div className="mt-4">
              <ScreenshotCarousel shots={[shots[0]]} compact showCaptions={false} showDots={false} />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              {researchPacketPreviewItems.map((item) => (
                <div key={item} className="text-sm leading-relaxed tracking-normal" style={{ color: "var(--muted)" }}>
                  {item}
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm leading-relaxed tracking-normal" style={{ color: "var(--muted)" }}>
              Everything stays tied to source files, saved documents, and analyst-reviewable outputs.
            </p>
          </div>
        </section>

        <section className="mt-8">
          <div className="grid gap-3 sm:grid-cols-3">
            {heroValueCards.map((card) => (
              <div key={card.title} className="h-full rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                <div className="text-sm font-semibold tracking-normal" style={{ color: "var(--text)" }}>
                  {card.title}
                </div>
                <div className="mt-2 text-[13px] leading-relaxed tracking-normal" style={{ color: "var(--muted)" }}>
                  {card.body}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="workflows" className="mt-16">
          {sectionEyebrow("What OREO does")}
          <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">From public information to investment work product</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            OREO is designed around the actual analyst workflow, not just a collection of tabs.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {workflowCards.map((card) => (
              <article key={card.title} className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                <h3 className="text-base font-semibold tracking-normal">{card.title}</h3>
                <p className="mt-3 text-sm leading-relaxed tracking-normal" style={{ color: "var(--muted)" }}>
                  {card.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-16">
          {sectionEyebrow("Built for")}
          <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">Built for different analyst workflows</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {analystWorkflowCards.map((card) => (
              <article key={card.title} className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                <h3 className="text-base font-semibold tracking-normal">{card.title}</h3>
                <p className="mt-3 text-sm leading-relaxed tracking-normal" style={{ color: "var(--muted)" }}>
                  {card.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-16">
          {sectionEyebrow("Product view")}
          <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">A quick look inside the research workstation</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Screens shown are from the live platform. Enter a ticker, choose a workflow, save source documents, and generate
            analyst-ready outputs.
          </p>
          <div className="mt-4">
            <ScreenshotCarousel shots={[...shots]} />
          </div>
        </section>

        <section id="modules" className="mt-16">
          {sectionEyebrow("Research modules")}
          <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">Core modules</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Use only what you need, or move through the full workflow from ticker to final memo.
          </p>
          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {coreModules.map((card) => (
              <article key={card.title} className="rounded-xl border p-3.5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                <h3 className="text-[15px] font-semibold tracking-normal">{card.title}</h3>
                <p className="mt-1.5 text-[13px] leading-[1.5] tracking-normal" style={{ color: "var(--muted)" }}>
                  {card.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section id="examples" className="mt-16">
          {sectionEyebrow("Use cases")}
          <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">Sample use cases</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            OREO is easiest to understand by seeing the workflow applied to real companies.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {sampleUseCases.map((card) => (
              <article key={card.title} className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--muted2)" }}>
                  {card.example}
                </div>
                <h3 className="mt-2 text-base font-semibold tracking-normal">{card.title}</h3>
                <p className="mt-3 text-sm leading-relaxed tracking-normal" style={{ color: "var(--muted)" }}>
                  {card.body}
                </p>
                <Link
                  href={`/register?ticker=${encodeURIComponent(card.example.split(",")[0].trim())}`}
                  className="mt-4 inline-flex text-sm font-semibold underline tracking-normal"
                  style={{ color: "var(--accent)" }}
                >
                  {card.cta}
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-16 rounded-2xl border p-6 sm:p-7" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-2xl font-semibold leading-tight">Start with one ticker.</div>
              <div className="mt-2 max-w-3xl text-sm leading-relaxed tracking-normal" style={{ color: "var(--muted)" }}>
                Create an account and generate your first source-backed research packet. Use OREO for credit diligence, equity
                research, special situations, student pitches, or public-company monitoring.
              </div>
              <div className="mt-2 text-xs tracking-normal" style={{ color: "var(--muted2)" }}>
                Free to use. No credit card required.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/register"
                className="rounded-md px-4 py-2 text-sm font-semibold tracking-normal"
                style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
              >
                Start research packet
              </Link>
              <Link
                href="/login"
                className="rounded-md border px-4 py-2 text-sm font-semibold tracking-normal"
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

