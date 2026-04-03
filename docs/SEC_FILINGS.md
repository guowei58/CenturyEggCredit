# SEC Filings — Which Files Handle the Data

Only the **Filings** tab uses real data. The rest of the app stays on mock data. Below is which files touch SEC/EDGAR and what they do.

---

## 1. **`src/lib/sec-edgar.ts`** — SEC API logic (no UI)

This file contains **all the SEC/EDGAR logic**. No React, no components.

- **What it does**
  - **`getCikFromTicker(ticker)`**  
    Calls the SEC’s company tickers list (`https://www.sec.gov/files/company_tickers.json`), finds the company whose ticker matches (e.g. `"LUMN"`), and returns its **CIK** (Central Index Key) as a 10-digit string. If the ticker isn’t found, it returns `null`.

  - **`getFilingsByCik(cik)`**  
    Calls the SEC submissions API for that CIK (`https://data.sec.gov/submissions/CIK{cik}.json`), reads the “recent” filings list, and returns a **list of filings** with: form (e.g. 10-K, 10-Q), filing date, description, and a **document URL** that points to the actual filing on SEC.gov.

  - **`getFilingsByTicker(ticker)`**  
    First gets the CIK with `getCikFromTicker`, then gets filings with `getFilingsByCik`. So you only need to know the ticker; this function does the rest.

- **Why it’s here**  
  Keeping this in `src/lib/` means the UI and the API route don’t contain SEC URL building or response parsing. Any change to how we talk to the SEC happens in this one file.

- **Requirements**  
  The SEC expects a **User-Agent** header and has a **rate limit** (e.g. 10 requests per second). This file sets the User-Agent; the rest of the app doesn’t need to know.

---

## 2. **`src/app/api/filings/[ticker]/route.ts`** — API route (backend only)

This is a **Next.js API route**: when the front end calls **`/api/filings/LUMN`** (or any ticker), this file runs on the server.

- **What it does**
  - Reads the **ticker** from the URL (e.g. `LUMN`).
  - Calls **`getFilingsByTicker(ticker)`** from `src/lib/sec-edgar.ts` (so all SEC logic stays in the lib).
  - Returns the result as **JSON** (company name, CIK, list of filings with type, date, description, document link).
  - If the ticker isn’t found or something fails, it returns an error response (404 or 500) with a short message.

- **Why use an API route**  
  The browser doesn’t call the SEC directly. The **client** calls **our** API route; the **server** calls the SEC. That way we can set the User-Agent and avoid CORS, and we keep the SEC base URLs and parsing out of the UI.

---

## 3. **`src/components/CompanyFilingsTab.tsx`** — Filings tab UI (client)

This is the **only UI** that uses real SEC data. It’s the content of the **Filings** tab in Company Analysis.

- **What it does**
  - Receives the **current ticker** (e.g. `LUMN`) as a prop. That’s the ticker the user has selected in the app (sidebar or company bar).
  - When the ticker changes, it **fetches** `GET /api/filings/{ticker}` (our API route above). No direct SEC URLs or logic here.
  - Shows a **loading** state while the request is in progress.
  - If the request fails (e.g. company not found), it shows an **error** message.
  - If it succeeds, it renders a **table** with:
    - **Filing type** (e.g. 10-K, 10-Q, 8-K)
    - **Filing date**
    - **Description** (from SEC)
    - **Document link** (“View →” that opens the filing on SEC.gov)

- **Why it’s separate**  
  This component is the only one that needs `useState` and `useEffect` for loading filings. The rest of Company Analysis doesn’t need to know about the API or loading states; it just renders `<CompanyFilingsTab ticker={ticker} />` when the Filings tab is selected.

---

## 4. **`src/components/CompanyAnalysis.tsx`** — Where the Filings tab is wired

- **What it does**  
  When the user selects the **Filings** tab, it renders **`<CompanyFilingsTab ticker={ticker} />`** instead of mock data. The `ticker` comes from the same state as the rest of Company Analysis (e.g. from the sidebar or company bar). So “type a ticker and load recent filings” is: change the ticker (sidebar search or quick-load) and open the Filings tab; the component will fetch and show filings for that ticker.

- **No SEC logic here**  
  This file doesn’t import the SEC lib or know about SEC URLs. It only imports and uses `CompanyFilingsTab`.

---

## Summary

| File | Role |
|------|------|
| **`src/lib/sec-edgar.ts`** | All SEC logic: ticker → CIK, fetch submissions, build filing list and document URLs. No UI. |
| **`src/app/api/filings/[ticker]/route.ts`** | Backend: receives ticker, calls the lib, returns JSON (or error). No UI. |
| **`src/components/CompanyFilingsTab.tsx`** | UI for the Filings tab: calls the API, shows loading/error/table with type, date, and document link. |
| **`src/components/CompanyAnalysis.tsx`** | Renders the Filings tab by rendering `CompanyFilingsTab` with the current ticker. |

Data flow: **User picks ticker** → **Filings tab** → **CompanyFilingsTab** fetches **/api/filings/{ticker}** → **API route** calls **sec-edgar.ts** → **SEC EDGAR** → response back to UI. No authentication, no database, no paid APIs; only the free SEC EDGAR APIs are used for the Filings tab.
