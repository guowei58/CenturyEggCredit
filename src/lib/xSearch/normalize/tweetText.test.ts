import { describe, expect, it } from "vitest";

import { resolveTweetDisplayText, resolveTweetMedia, toMediaByKey } from "./tweetText";

describe("tweetText", () => {
  it("uses note_tweet body when longer than preview", () => {
    const { text, isTruncatedPreview } = resolveTweetDisplayText({
      text: "Short preview…",
      note_tweet: { text: "Short preview with the full earnings commentary and price target details." },
    });
    expect(isTruncatedPreview).toBe(true);
    expect(text).toContain("full earnings commentary");
  });

  it("expands t.co links to expanded_url", () => {
    const { text } = resolveTweetDisplayText({
      text: "Read more https://t.co/abc123",
      entities: {
        urls: [{ url: "https://t.co/abc123", expanded_url: "https://example.com/report" }],
      },
    });
    expect(text).toContain("https://example.com/report");
    expect(text).not.toContain("t.co/abc123");
  });

  it("maps attached media by key", () => {
    const mediaByKey = toMediaByKey({
      media: [{ media_key: "m1", type: "photo", url: "https://pbs.twimg.com/photo.jpg", alt_text: "Chart" }],
    });
    const media = resolveTweetMedia({ attachments: { media_keys: ["m1"] } }, mediaByKey);
    expect(media).toHaveLength(1);
    expect(media[0]?.url).toContain("photo.jpg");
    expect(media[0]?.altText).toBe("Chart");
  });
});
