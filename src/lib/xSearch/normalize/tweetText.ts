type UrlEntity = { url?: string; expanded_url?: string; display_url?: string };

type TweetTextSource = {
  text?: string;
  note_tweet?: { text?: string };
  entities?: {
    urls?: UrlEntity[];
    cashtags?: Array<{ tag?: string }>;
    hashtags?: Array<{ tag?: string }>;
    mentions?: Array<{ username?: string }>;
  };
  attachments?: { media_keys?: string[] };
};

export type XApiMedia = {
  media_key?: string;
  type?: string;
  url?: string;
  preview_image_url?: string;
  alt_text?: string;
};

/** Prefer note-tweet full body; expand t.co links to display URLs when possible. */
export function resolveTweetDisplayText(tweet: TweetTextSource): { text: string; isTruncatedPreview: boolean } {
  const noteText = tweet.note_tweet?.text?.trim();
  const baseText = (tweet.text ?? "").trim();
  const isTruncatedPreview = Boolean(noteText && noteText.length > baseText.length);
  const raw = noteText && noteText.length >= baseText.length ? noteText : baseText;
  return { text: expandUrlEntities(raw, tweet.entities?.urls), isTruncatedPreview };
}

function expandUrlEntities(text: string, urls: UrlEntity[] | undefined): string {
  if (!urls?.length) return text;
  let out = text;
  for (const u of urls) {
    const short = u.url?.trim();
    const expanded = u.expanded_url?.trim();
    if (!short || !expanded || short === expanded) continue;
    out = out.split(short).join(expanded);
  }
  return out;
}

export function resolveTweetMedia(
  tweet: TweetTextSource,
  mediaByKey: Map<string, XApiMedia>
): import("../types").XPostMedia[] {
  const keys = tweet.attachments?.media_keys ?? [];
  const out: import("../types").XPostMedia[] = [];
  for (const key of keys) {
    const m = mediaByKey.get(key);
    if (!m) continue;
    const type = (m.type ?? "unknown").toLowerCase();
    out.push({
      type,
      url: m.url?.trim() || null,
      previewUrl: m.preview_image_url?.trim() || null,
      altText: m.alt_text?.trim() || null,
    });
  }
  return out;
}

export function toMediaByKey(includes: { media?: XApiMedia[] } | undefined): Map<string, XApiMedia> {
  const m = new Map<string, XApiMedia>();
  for (const item of includes?.media ?? []) {
    const key = item.media_key?.trim();
    if (key) m.set(key, item);
  }
  return m;
}
