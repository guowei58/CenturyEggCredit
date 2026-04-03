# CenturyEggCredit

A simple Next.js dashboard starter with TypeScript, Tailwind CSS, and the App Router.

## File structure (plain English)

- **`package.json`** – Lists the project name, version, and scripts (`npm run dev`, `npm run build`, `npm run start`, `npm run lint`). It also lists dependencies (e.g. Next.js, React) and dev dependencies (TypeScript, Tailwind, ESLint).

- **`tsconfig.json`** – Tells TypeScript how to compile your code and where to find things. The `paths` section lets you use `@/` as a shortcut for the `src/` folder (e.g. `@/components/Header`).

- **`next.config.js`** – Configuration for Next.js (e.g. redirects, env vars). Ours is minimal for now.

- **`tailwind.config.ts`** – Tells Tailwind which files to scan for class names and lets you extend the theme (colors, fonts, etc.).

- **`postcss.config.mjs`** – PostCSS runs Tailwind and Autoprefixer so your CSS is built correctly.

- **`next-env.d.ts`** – TypeScript declaration file for Next.js. You don’t edit this; it’s generated/used by the framework.

- **`.eslintrc.json`** – ESLint rules. We use the recommended Next.js set (`next/core-web-vitals`).

- **`.gitignore`** – Tells Git which files and folders to ignore (e.g. `node_modules`, `.next`, env files).

- **`src/app/`** – This is the **App Router** folder. What you put here defines your routes and layout:
  - **`layout.tsx`** – Wraps every page. Shared UI (e.g. header, footer) and things like `<html>` and `<body>` go here. All pages “live inside” this layout.
  - **`page.tsx`** – The component that renders at the **home page** (`/`). Editing this changes what you see at the root URL.
  - **`globals.css`** – Global styles. We use it to import Tailwind’s base, components, and utilities.

- **`src/components/`** – Feature-level components: `CompanyAnalysis.tsx` and `PMDashboard.tsx`. They compose the main content areas.

- **`src/components/layout/`** – Shell layout: `TopNav`, `LeftSidebar`, `CompanyBar`, `ChatDrawer`. No business data defined here; they receive props and use mock data from `src/data` for lists.

- **`src/components/ui/`** – Reusable UI building blocks: `Card`, `MetricTile`, `TabBar`, `DataTable`, `EmptyState`. Used by the feature components so repeated UI lives in one place.

- **`src/data/`** – Mock data only (e.g. company bar, overview, filings, ratings, covenants, news, ideas, tab labels, watchlist, quick-load tickers). No UI; components import from here.

- **`src/lib/`** – Shared logic only (e.g. `tabs.ts` for tab IDs; `sec-edgar.ts` for SEC EDGAR API calls used by the Filings tab). No UI.

- **SEC Filings (real data)** – Only the **Filings** tab uses live SEC data. For which files handle the SEC connection and how they work, see **`docs/SEC_FILINGS.md`**.

- **Saved tab content (per ticker)** – When you select a ticker (GO) or switch companies, the app creates **`data/saved-tickers/{TICKER}/`** on the server. Each **Save** on Business Model, Company History, Porter's Five Forces, Org Chart (AI response), News & Events, Presentations, Earnings Releases, Trade Recommendations, or Notes & Thoughts writes a `.txt` file there (and still mirrors to `localStorage` as a backup). These files are gitignored except the empty folder placeholder.

- **`src/`** – Main source code. The `@/` alias in `tsconfig.json` points here. For a full walk-through of the updated structure, see **`docs/FILE_STRUCTURE.md`**.

## Environment (Presentations tab)

The **Presentations** tab uses Claude to discover management presentations. Set in `.env.local` (or your env):

- **`ANTHROPIC_API_KEY`** – Your Anthropic API key (required for Presentations). All Claude calls are server-side; the key is never sent to the browser.
- **`ANTHROPIC_PRESENTATIONS_MODEL`** – (Optional) Claude model for presentations. Default is `claude-opus-4-6`. Override if needed.
- **Web search** – The Presentations tab uses Claude’s web search tool to find current presentation links. Your org must have **web search enabled** in the [Anthropic Console](https://console.anthropic.com) (Settings → Privacy / features).

## Getting started

1. Install dependencies: `npm install`
2. Run the dev server: `npm run dev`
3. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Scripts

- `npm run clean` – Delete the `.next` build cache (fixes many dev-server errors).
- `npm run dev` – Start the development server (hot reload).
- `npm run dev:clean` – Clean cache, then start dev (use this if you see missing `*.js` chunk errors).
- `npm run dev:turbo` – Dev server with Turbopack (alternative bundler; can avoid webpack chunk glitches).
- `npm run build` – Build the app for production.
- `npm run start` – Run the production build locally.
- `npm run lint` – Run ESLint.

## Troubleshooting: `Cannot find module './NNN.js'`

If the app shows a server error like **Cannot find module './682.js'** (or another number), the `.next` folder is usually **out of sync**—often because **two `next dev` processes** were running on the same project (e.g. two terminals or two ports) and both wrote to `.next`.

1. Stop **all** dev servers for this repo (every terminal running `next dev`).
2. Run **`npm run dev:clean`** (or `npm run clean` then `npm run dev`).
3. Use **only one** dev server at a time on this folder.

If it keeps happening, try **`npm run dev:turbo`** instead of `npm run dev`.
