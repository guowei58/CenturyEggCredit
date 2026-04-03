/**
 * Representative normalized rows for tests / documentation (not live search results).
 * Tickers: Hertz, Lumen, AMC — includes note/ABS-heavy wording for classifier checks.
 */
import type { NormalizedRatingsLink } from "../types";

export const fixtureLumenSpAction: NormalizedRatingsLink = {
  id: "fixture-lumen-sp",
  agency: "S&P",
  title: "Lumen Technologies Inc. Rating Action — Outlook Revised To Stable From Negative",
  url: "https://www.spglobal.com/ratings/en/news/lumen-outlook-stable",
  snippet: "On March 1, S&P Global Ratings revised the outlook to stable...",
  query: "site:spglobal.com ...",
  sourceDomain: "www.spglobal.com",
  resultType: "rating_action",
  companyMatchScore: 88,
  instrumentHints: [],
  accessLevel: "subscription_likely",
  publishedDate: "2023-03-01T00:00:00Z",
};

export const fixtureHertzFitchAbs: NormalizedRatingsLink = {
  id: "fixture-hertz-abs",
  agency: "Fitch",
  title: "Hertz Corp. — ABS Program Update",
  url: "https://www.fitchratings.com/research/structured-finance/hertz-abs",
  snippet: "Fitch Ratings has updated its analysis of the fleet ABS program...",
  query: "site:fitchratings.com ...",
  sourceDomain: "www.fitchratings.com",
  resultType: "issue_rating",
  companyMatchScore: 72,
  instrumentHints: ["ABS"],
  accessLevel: "unknown",
  publishedDate: null,
};

export const fixtureAmcMoodysSenior: NormalizedRatingsLink = {
  id: "fixture-amc-moodys",
  agency: "Moody's",
  title: "AMC Entertainment Holdings — Senior Unsecured Debt",
  url: "https://ratings.moodys.com/ratings-news/amc-senior-unsecured",
  snippet: "...corporate family rating... senior unsecured notes...",
  query: "site:moodys.com ...",
  sourceDomain: "ratings.moodys.com",
  resultType: "issue_rating",
  companyMatchScore: 65,
  instrumentHints: ["Senior unsecured"],
  accessLevel: "subscription_likely",
  publishedDate: "2022-11-15",
};

export const mockFixtureResults: NormalizedRatingsLink[] = [
  fixtureLumenSpAction,
  fixtureHertzFitchAbs,
  fixtureAmcMoodysSenior,
];
