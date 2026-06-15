import { describe, expect, it } from "vitest";

import { isLikelyTickerInstrumentPage } from "./stockPageFilter";

describe("isLikelyTickerInstrumentPage", () => {
  it("filters WSJ analyst estimates / stock price pages", () => {
    expect(
      isLikelyTickerInstrumentPage({
        title: "HTZ | Hertz Global Holdings Inc. Analyst Estimates & Ratings - WSJ",
        url: "https://www.wsj.com/market-data/quotes/HTZ/research-ratings",
      })
    ).toBe(true);
    expect(
      isLikelyTickerInstrumentPage({
        title: "Hertz Global Holdings Inc. (HTZ) Stock Price Today - WSJ",
        url: "https://www.wsj.com/market-data/quotes/HTZ",
      })
    ).toBe(true);
  });

  it("filters FT exchange summary pages", () => {
    expect(
      isLikelyTickerInstrumentPage({
        title: "Hertz Global Holdings Inc, HTZ:NSQ summary - Financial Times",
        url: "https://markets.ft.com/data/equities/tearsheet/summary?s=HTZ:NSQ",
      })
    ).toBe(true);
  });

  it("filters Yahoo quote and options chain pages", () => {
    expect(
      isLikelyTickerInstrumentPage({
        title: "Hertz Global Holdings, Inc (HTZ) Stock Price, News, Quote & History - Yahoo Finance",
        url: "https://finance.yahoo.com/quote/HTZ/",
      })
    ).toBe(true);
    expect(
      isLikelyTickerInstrumentPage({
        title: "HTZ Jun 2026 6.500 call (HTZ260618C00006500) Stock Price, News, Quote & History - Yahoo Finance",
        url: "https://finance.yahoo.com/quote/HTZ260618C00006500/",
      })
    ).toBe(true);
  });

  it("filters Bloomberg and Reuters company profile pages", () => {
    expect(
      isLikelyTickerInstrumentPage({
        title: "Hertz Global Holdings Inc - Bloomberg.com",
        url: "https://news.google.com/rss/articles/abc",
      })
    ).toBe(true);
    expect(
      isLikelyTickerInstrumentPage({
        title: "Nexstar Media Group Inc - Reuters",
        url: "https://news.google.com/rss/articles/def",
      })
    ).toBe(true);
    expect(
      isLikelyTickerInstrumentPage({
        title: "Check out Nexstar Media Group's stock price (NXST) in real time - CNBC",
        url: "https://www.cnbc.com/quotes/NXST",
      })
    ).toBe(true);
  });

  it("keeps real news headlines", () => {
    expect(
      isLikelyTickerInstrumentPage({
        title: "Hertz Global beats Q4 earnings estimates as travel demand rebounds",
        url: "https://www.reuters.com/business/hertz-global-beats-q4-earnings-2024-02-08/",
      })
    ).toBe(false);
    expect(
      isLikelyTickerInstrumentPage({
        title: "Coatue's Philippe Laffont Bought This Beaten-Down Stock — Now It's Flashing A Golden Cross",
        url: "https://finance.yahoo.com/news/coatues-philippe-laffont-bought-beaten-123456789.html",
      })
    ).toBe(false);
  });
});
