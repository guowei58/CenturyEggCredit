import { chromium } from "playwright";
import type { IrPage, IrSection, IrAsset } from "../types";
import { classifyLink } from "../classify/linkClassifier";
import { contentHash, hostnameOf, isSameDomain, normalizeUrlForMatch, nowIso, safeTextExcerpt, stableId, toAbsoluteUrl } from "../utils";

type ExtractedLink = {
  href: string;
  text: string;
  contextHeading: string | null;
  contextText: string | null;
  sourceType: "link" | "iframe" | "button";
};

type ExtractedDom = {
  finalUrl: string;
  canonicalUrl: string | null;
  title: string | null;
  metaDescription: string | null;
  headings: Array<{ text: string; level: number; order: number }>;
  textBlocks: Array<{ headingOrder: number | null; text: string; order: number }>;
  links: ExtractedLink[];
};

async function safeExpandCommonControls(page: import("playwright").Page): Promise<void> {
  // Best-effort expansion: details, aria-expanded buttons.
  try {
    await page.evaluate(() => {
      const details = Array.from(document.querySelectorAll("details"));
      for (const d of details) d.open = true;
    });
  } catch {
    // ignore
  }
  // Click a small number of expandable toggles
  const candidates = await page.locator("[aria-expanded='false']").all();
  for (let i = 0; i < Math.min(8, candidates.length); i++) {
    try {
      await candidates[i]!.click({ timeout: 800, trial: true });
      await candidates[i]!.click({ timeout: 800 });
    } catch {
      // ignore
    }
  }
}

function buildSections(dom: ExtractedDom, irPageId: string): IrSection[] {
  // Create a synthetic root section at level 0.
  const sections: IrSection[] = [];
  const stack: Array<{ id: string; level: number; order: number }> = [];

  const rootId = stableId([irPageId, "root"]);
  sections.push({
    id: rootId,
    ir_page_id: irPageId,
    parent_section_id: null,
    heading: null,
    level: 0,
    order_index: 0,
    text_content: "",
  });
  stack.push({ id: rootId, level: 0, order: 0 });

  const sortedHeadings = [...dom.headings].sort((a, b) => a.order - b.order);

  for (const h of sortedHeadings) {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= h.level) stack.pop();
    const parent = stack[stack.length - 1] ?? { id: rootId, level: 0, order: 0 };
    const id = stableId([irPageId, `h:${h.order}:${h.level}:${h.text}`]);
    sections.push({
      id,
      ir_page_id: irPageId,
      parent_section_id: parent.id,
      heading: h.text,
      level: h.level,
      order_index: h.order,
      text_content: "",
    });
    stack.push({ id, level: h.level, order: h.order });
  }

  // Attach text blocks to nearest heading by order.
  const byOrder = new Map<number, IrSection>();
  for (const s of sections) byOrder.set(s.order_index, s);

  const headingOrders = sortedHeadings.map((h) => h.order);
  for (const tb of dom.textBlocks) {
    const text = tb.text.trim();
    if (!text) continue;
    let targetId = rootId;
    if (tb.headingOrder != null) {
      targetId = stableId([irPageId, `h:${tb.headingOrder}`]);
    } else if (headingOrders.length) {
      // closest previous heading
      const prev = headingOrders.filter((o) => o <= tb.order).sort((a, b) => b - a)[0];
      if (prev != null) targetId = stableId([irPageId, `h:${prev}`]);
    }
    const sec = sections.find((s) => s.id === targetId);
    if (sec) sec.text_content = `${sec.text_content}${sec.text_content ? "\n\n" : ""}${text}`.trim();
    else {
      const root = sections[0]!;
      root.text_content = `${root.text_content}${root.text_content ? "\n\n" : ""}${text}`.trim();
    }
  }

  return sections;
}

export async function renderAndExtractPage(params: {
  irSourceId: string;
  url: string;
  depth: number;
  timeoutMs: number;
  rootUrl: string;
}): Promise<{
  page: IrPage;
  sections: IrSection[];
  assets: Omit<IrAsset, "id" | "ir_source_id" | "created_at" | "updated_at">[];
  discoveredChildPages: string[];
}> {
  const startedAt = nowIso();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "CenturyEggCredit/1.0 (IR indexer)",
  });
  const page = await context.newPage();

  let renderStatus: IrPage["render_status"] = "ok";
  let finalUrl = params.url;
  let dom: ExtractedDom | null = null;

  try {
    await page.goto(params.url, { waitUntil: "networkidle", timeout: params.timeoutMs });
    finalUrl = page.url();
    await safeExpandCommonControls(page);
    dom = await page.evaluate((): ExtractedDom => {
      const canonicalEl = document.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
      const canonicalUrl = canonicalEl?.href ? canonicalEl.href : null;
      const title = document.title || null;
      const metaDesc = (document.querySelector("meta[name='description']") as HTMLMetaElement | null)?.content ?? null;

      let order = 0;
      const headings: Array<{ text: string; level: number; order: number }> = [];
      const textBlocks: Array<{ headingOrder: number | null; text: string; order: number }> = [];

      // Walk DOM in document order and capture headings + visible text blocks.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      const headingStack: Array<{ level: number; order: number }> = [];

      const isVisible = (el: Element): boolean => {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        const rect = (el as HTMLElement).getBoundingClientRect?.();
        if (rect && rect.width === 0 && rect.height === 0) return false;
        return true;
      };

      const cleanText = (s: string): string =>
        s.replace(/\s+/g, " ").trim();

      let node: Node | null = walker.currentNode;
      while (node) {
        const el = node as Element;
        order += 1;
        const tag = el.tagName?.toLowerCase?.() ?? "";
        if (!tag || !isVisible(el)) {
          node = walker.nextNode();
          continue;
        }
        if (/^h[1-4]$/.test(tag)) {
          const level = parseInt(tag.slice(1), 10);
          const text = cleanText(el.textContent ?? "");
          if (text) {
            headings.push({ text, level, order });
            headingStack.push({ level, order });
          }
        } else if (tag === "p" || tag === "li" || tag === "div") {
          const text = cleanText(el.textContent ?? "");
          if (text && text.length >= 40) {
            const lastHeading = headingStack.length ? headingStack[headingStack.length - 1]!.order : null;
            textBlocks.push({ headingOrder: lastHeading, text, order });
          }
        }
        node = walker.nextNode();
      }

      const links: ExtractedLink[] = [];
      const pickContextHeading = (el: Element): string | null => {
        const h = el.closest("section,article,main,div")?.querySelector("h1,h2,h3,h4");
        const t = h?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        return t || null;
      };
      const contextText = (el: Element): string | null => {
        const p = el.closest("li,p,div");
        const t = p?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        return t.length > 0 ? t.slice(0, 240) : null;
      };

      document.querySelectorAll("a[href]").forEach((a) => {
        const href = (a as HTMLAnchorElement).getAttribute("href") ?? "";
        const text = cleanText((a as HTMLAnchorElement).textContent ?? "");
        links.push({
          href,
          text,
          contextHeading: pickContextHeading(a),
          contextText: contextText(a),
          sourceType: "link",
        });
      });

      document.querySelectorAll("iframe[src]").forEach((f) => {
        const src = (f as HTMLIFrameElement).getAttribute("src") ?? "";
        links.push({
          href: src,
          text: "iframe",
          contextHeading: pickContextHeading(f),
          contextText: contextText(f),
          sourceType: "iframe",
        });
      });

      // Buttons that look like links
      document.querySelectorAll("button").forEach((b) => {
        const t = cleanText(b.textContent ?? "");
        const dataHref =
          (b as HTMLElement).getAttribute("data-href") ||
          (b as HTMLElement).getAttribute("data-url") ||
          "";
        if (dataHref) {
          links.push({ href: dataHref, text: t, contextHeading: pickContextHeading(b), contextText: contextText(b), sourceType: "button" });
        }
      });

      return {
        finalUrl: location.href,
        canonicalUrl,
        title,
        metaDescription: metaDesc,
        headings,
        textBlocks,
        links,
      };
    });
  } catch {
    renderStatus = "error";
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const canonicalUrl = dom?.canonicalUrl ? dom.canonicalUrl : null;
  const title = dom?.title ?? null;
  const metaDescription = dom?.metaDescription ?? null;

  const rawText = (dom?.textBlocks ?? []).map((t) => t.text).join("\n\n");
  const excerpt = safeTextExcerpt(rawText, 500);
  const chash = contentHash(`${title ?? ""}\n${metaDescription ?? ""}\n${rawText}`);

  const irPageId = stableId([params.irSourceId, `page:${finalUrl}`]);
  const pageRec: IrPage = {
    id: irPageId,
    ir_source_id: params.irSourceId,
    url: params.url,
    canonical_url: canonicalUrl,
    title,
    meta_description: metaDescription,
    depth: params.depth,
    fetched_at: startedAt,
    content_hash: chash,
    raw_text_excerpt: excerpt,
    render_status: renderStatus,
    final_url: finalUrl,
  };

  const sections = dom ? buildSections(dom, irPageId) : [
    {
      id: stableId([irPageId, "root"]),
      ir_page_id: irPageId,
      parent_section_id: null,
      heading: null,
      level: 0,
      order_index: 0,
      text_content: "",
    }
  ];

  const rootHost = hostnameOf(params.rootUrl);
  const assets: Array<Omit<IrAsset, "id" | "ir_source_id" | "created_at" | "updated_at">> = [];
  const childPages: string[] = [];

  for (const l of dom?.links ?? []) {
    const abs = toAbsoluteUrl(finalUrl, l.href);
    if (!abs) continue;
    const norm = normalizeUrlForMatch(abs);
    if (!norm) continue;
    const host = hostnameOf(norm);
    const same = rootHost ? (host === rootHost || host.endsWith(`.${rootHost}`)) : isSameDomain(params.rootUrl, norm);
    const cls = classifyLink({ url: norm, anchorText: l.text, contextHeading: l.contextHeading, contextText: l.contextText });
    assets.push({
      ir_page_id: irPageId,
      ir_section_id: null,
      url: abs,
      normalized_url: norm,
      title: l.text || null,
      asset_type: cls.assetType,
      file_extension: cls.extension,
      source_type: l.sourceType,
      hostname: host,
      anchor_text: l.text || null,
      context_text: l.contextHeading ?? l.contextText ?? null,
      published_at: null,
      is_same_domain: same,
      is_from_sec: false,
      metadata_json: null,
    });

    // Candidate child pages: same-domain, html pages, and IR-ish paths.
    const p = (() => { try { return new URL(norm).pathname.toLowerCase(); } catch { return ""; } })();
    const looksIr =
      /investor|ir|financial|results|events|presentations|sec|filings|news|press|reports/.test(p);
    if (same && cls.assetType === "html_page" && looksIr) childPages.push(norm);
  }

  return {
    page: pageRec,
    sections,
    assets,
    discoveredChildPages: Array.from(new Set(childPages)),
  };
}

