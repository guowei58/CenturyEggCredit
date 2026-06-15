import { describe, expect, it } from "vitest";

import { resolveMajorOutletArticleContext } from "./majorOutletRss";

describe("resolveMajorOutletArticleContext", () => {
  it("uses resolved publisher URL when redirect succeeds", () => {
    const ctx = resolveMajorOutletArticleContext("https://www.reuters.com/world/story", {
      link: "https://news.google.com/rss/articles/abc",
      sourceUrl: "https://www.reuters.com",
      sourceName: "Reuters",
    });
    expect(ctx).toEqual({
      host: "reuters.com",
      openUrl: "https://www.reuters.com/world/story",
      sourceName: "Reuters",
    });
  });

  it("falls back to RSS source when redirect stays on news.google.com", () => {
    const googleLink = "https://news.google.com/rss/articles/abc?oc=5";
    const ctx = resolveMajorOutletArticleContext(googleLink, {
      link: googleLink,
      sourceUrl: "https://www.reuters.com",
      sourceName: "Reuters",
    });
    expect(ctx).toEqual({
      host: "reuters.com",
      openUrl: googleLink,
      sourceName: "Reuters",
    });
  });

  it("rejects when neither resolved URL nor RSS source is an allowed outlet", () => {
    const ctx = resolveMajorOutletArticleContext("https://news.google.com/rss/articles/abc", {
      link: "https://news.google.com/rss/articles/abc",
      sourceUrl: "https://example.com",
      sourceName: "Example",
    });
    expect(ctx).toBeNull();
  });
});
