# File structure (plain English)

This document describes how the **OREO** (Organized Research, Exposure & Outlook) codebase is organized — the research tool from Century Egg Credit. The same UI is preserved; the goal is clear separation between layout, reusable UI, feature components, and data.

---

## Root-level config

- **`package.json`** – Project name, version, scripts (`npm run dev`, `build`, `start`, `lint`), and dependencies. No app logic.
- **`tsconfig.json`** – TypeScript config. The `paths` entry makes `@/` point to `src/` so you can import like `@/components/ui` or `@/data/mock`.
- **`next.config.js`** – Next.js config (minimal for now).
- **`tailwind.config.ts`** – Tailwind: which files to scan, theme (e.g. fonts).
- **`postcss.config.mjs`** – Runs Tailwind and Autoprefixer when building CSS.
- **`.eslintrc.json`** – ESLint rules.
- **`.gitignore`** – Files and folders Git should ignore.

---

## `src/app/` — Routes and global styles

This is the **App Router**. It controls what you see at each URL and the global shell.

- **`layout.tsx`** – Root layout. Wraps every page with `<html>`, `<body>`, and global styles. It does not render the dashboard; the page does.
- **`page.tsx`** – The **home page** (`/`). It holds the top-level state (which section is active, which ticker, which tab, whether chat is open) and composes the shell: top nav, sidebar, main area (Company Analysis or PM Dashboard), and chat drawer. It imports layout and feature components and uses tab IDs from `@/lib/tabs`.
- **`globals.css`** – Global styles and CSS variables (colors, spacing). It also defines shared **component classes** used across the app (e.g. `.card-shell`, `.card-header`, `.metric-tile`, `.table-institutional`, `.tab-bar-item`, `.btn-shell`). Reusable UI components use these classes so the look stays consistent.

---

## `src/data/` — Data only (no UI)

All **mock data** lives here. No React components, no JSX. Components import from here to display data but do not define it.

- **`mock.ts`** – Mock data for the dashboard: company bar (e.g. LUMN), overview (profile, filing activity, recent filings), capital structure, ratings, covenants, news, ideas & alerts, plus the **tab labels** for Company Analysis and PM Dashboard (e.g. `companyAnalysisTabs`, `pmDashboardTabs`). Also quick-load tickers and watchlist. No real API or database is used.

---

## `src/lib/` — Shared logic (no UI)

Small utilities used by the app. No components, no JSX.

- **`tabs.ts`** – Builds **tab IDs** from the tab labels in `@/data/mock` (e.g. "Overview" → `"overview"`, "News & Events" → `"news-events"`). Exports `companyAnalysisTabIds`, `pmDashboardTabIds`, and helpers. This is the single place that defines how a tab label becomes a URL-safe id, so the page and the tab bars stay in sync.

---

## `src/components/` — Feature-level components

These are the **main sections** of the app. They use layout and UI building blocks and get their data from `@/data/mock`.

- **`CompanyAnalysis.tsx`** – The Company Analysis area: company bar (when a ticker is selected), tab bar, and content for each tab (Overview, Financials, Capital Structure, etc.). It uses `CompanyBar` from layout and `Card`, `TabBar`, `MetricTile`, `DataTable`, `EmptyState` from UI. All content is driven by mock data; no API calls.
- **`PMDashboard.tsx`** – The PM Dashboard area: tab bar and content for each tab (Screeners, Relative Value, Distressed, Portfolio, Technicals, Ideas & Alerts). Uses `TabBar` and `Card` from UI and mock data for the Ideas list.

---

## `src/components/layout/` — Shell layout (no business data)

Layout pieces that define the **frame** of the app: top bar, left sidebar, company header strip, and chat drawer. They receive callbacks and minimal state (e.g. current section, current ticker); any **lists** (e.g. watchlist, quick-load tickers) still come from `@/data/mock` so data stays in one place.

- **`TopNav.tsx`** – Top bar: logo, “Company Analysis” / “PM Dashboard” switcher, Watchlist / EDGAR / AI Chat buttons.
- **`LeftSidebar.tsx`** – Left sidebar: ticker search (input + GO), Watchlist list, Quick Load ticker chips. Uses `mockWatchlist` and `quickLoadTickers` from `@/data/mock`.
- **`CompanyBar.tsx`** – The strip below the main tab bar when a company is loaded: ticker chip, company name and meta, FY End / Latest / Filings stats, Watchlist / EDGAR buttons. Receives a `CompanyBarData` object (same shape as `mockCompanyBar`).
- **`ChatDrawer.tsx`** – Right-side AI chat panel (and floating button): header, welcome message, input, suggestion chips. Mock only; no real AI.
- **`index.ts`** – Re-exports the layout components and `CompanyBarData` so the page can do `import { TopNav, LeftSidebar, ChatDrawer } from "@/components/layout"`.

---

## `src/components/ui/` — Reusable UI building blocks

Small, **presentational** components used in multiple places. They do not fetch data; they receive it via props or children. Styling is done with the classes from `globals.css` so the look stays the same as before.

- **`Card.tsx`** – Wrapper that applies the card style and an optional **title** (rendered as `.card-header`). Used for every card section (e.g. Company Profile, Filing Activity, Credit Metrics).
- **`MetricTile.tsx`** – A small stat block: label, value, optional subtitle, optional value color. Uses the `.metric-tile` (and `.metric-label` / `.metric-value`) styles. Used for filing counts, credit metrics, etc.
- **`TabBar.tsx`** – A horizontal list of tabs. Accepts an array of `{ id, label }`, the active id, and an `onSelect` callback. Supports two variants: `company` (accent underline) and `pm` (blue underline), matching the existing tab styles.
- **`DataTable.tsx`** – A thin wrapper around `<table className="table-institutional">`. Used for profile tables, filings tables, debt schedule, etc.
- **`EmptyState.tsx`** – Centered empty state: icon, title, description, and optional actions (e.g. quick-load buttons). Used when no company is selected in Company Analysis.
- **`index.ts`** – Re-exports the UI components (and `TabBarVariant`) so features can do `import { Card, MetricTile, TabBar, DataTable, EmptyState } from "@/components/ui"`.

---

## How it fits together

1. **`page.tsx`** owns the state (section, ticker, company tab, PM tab, chat open) and imports **layout** (TopNav, LeftSidebar, ChatDrawer) and **feature** components (CompanyAnalysis, PMDashboard). Tab IDs come from **`lib/tabs`**.
2. **Layout** components render the shell; they only need callbacks and the minimal state passed from the page. Sidebar data (watchlist, quick-load) is still read from **`data/mock`**.
3. **CompanyAnalysis** and **PMDashboard** use **UI** components (Card, TabBar, MetricTile, DataTable, EmptyState) and **layout** (CompanyBar) so repeated UI is in one place. They read all content from **`data/mock`**.
4. **Mock data** is only in **`src/data/mock.ts`**. **Tab IDs** are derived only in **`src/lib/tabs.ts`** from the labels in mock. No duplicated data or id logic.

The visual design is unchanged; the code is organized so that layout, UI, features, and data are clearly separated and easy to extend.
