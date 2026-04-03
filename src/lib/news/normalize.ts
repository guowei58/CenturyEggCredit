import { createHash } from "crypto";

import type { NormalizedNewsArticle } from "./types";
import { normalizeUrlForMatch } from "./utils";

export function makeArticleId(url: string, title: string): string {
  const canon = normalizeUrlForMatch(url) ?? url;
  return createHash("sha256").update(`${canon}\n${title}`).digest("hex").slice(0, 22);
}

export function attachNormalizedUrl(article: NormalizedNewsArticle): NormalizedNewsArticle {
  const nu = normalizeUrlForMatch(article.url);
  return { ...article, normalizedUrl: nu ?? undefined };
}
