"use client";

import type { AnchorHTMLAttributes, ImgHTMLAttributes, TableHTMLAttributes } from "react";
import { useLayoutEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkLinkify from "remark-linkify";
import remarkBreaks from "remark-breaks";
import DOMPurify from "dompurify";
import { SaveFilingLinkButton } from "@/components/SaveFilingLinkButton";
import { saveRemoteUrlForTicker } from "@/lib/save-remote-url-client";

let domPurifyLinkHookInstalled = false;

function ensureExternalLinksOpenInNewTab(): void {
  if (typeof window === "undefined" || domPurifyLinkHookInstalled) return;
  domPurifyLinkHookInstalled = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName !== "A" || !node.hasAttribute("href")) return;
    const href = (node.getAttribute("href") || "").trim();
    if (!href || href.startsWith("#")) return;
    const h = href.toLowerCase();
    if (h.startsWith("javascript:") || h.startsWith("mailto:") || h.startsWith("tel:")) return;
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  });
}

function isHttpUrl(href: string): boolean {
  const h = href.trim();
  return /^https?:\/\//i.test(h) && !/^javascript:/i.test(h);
}

function SavedHtmlContentWithSaveButtons({ html, ticker }: { html: string; ticker: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !ticker.trim()) return;
    const anchors = root.querySelectorAll("a[href]");
    anchors.forEach((node) => {
      const a = node as HTMLAnchorElement;
      const href = (a.getAttribute("href") || "").trim();
      if (!isHttpUrl(href)) return;
      if (a.closest(".saved-response-link-wrap")) return;

      const span = document.createElement("span");
      span.className =
        "saved-response-link-wrap inline-flex flex-wrap items-center gap-x-0.5 align-baseline max-w-full";
      a.parentNode?.insertBefore(span, a);
      span.appendChild(a);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Save";
      btn.className =
        "ml-1 inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition disabled:opacity-60";
      btn.style.borderColor = "var(--border2)";
      btn.style.color = "var(--muted2)";
      btn.style.background = "transparent";
      btn.title = "Save to Saved Documents (PDF)";

      const resetIdle = () => {
        btn.textContent = "Save";
        btn.style.color = "var(--muted2)";
        btn.style.borderColor = "var(--border2)";
        btn.style.background = "transparent";
        btn.title = "Save to Saved Documents (PDF)";
        btn.disabled = false;
      };

      btn.addEventListener("click", () => {
        void (async () => {
          btn.disabled = true;
          btn.textContent = "…";
          const r = await saveRemoteUrlForTicker(ticker.trim(), href, "saved-documents");
          if (r.ok) {
            btn.textContent = "Saved";
            btn.style.color = "var(--accent)";
            btn.style.borderColor = "var(--accent)";
            btn.style.background = "var(--card2)";
            setTimeout(resetIdle, 2200);
          } else {
            btn.textContent = "Retry";
            btn.style.color = "var(--danger)";
            btn.title = r.error;
            btn.disabled = false;
          }
        })();
      });
      span.appendChild(btn);
    });
  }, [html, ticker]);

  return <div ref={ref} className="saved-html-content" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function SavedRichText({
  content,
  ticker,
}: {
  content: string;
  /** When set (non-empty), shows a Save control next to each http(s) link after content is shown. */
  ticker?: string;
}) {
  const safeTicker = ticker?.trim() ?? "";
  const showSave = safeTicker.length > 0;

  const components = useMemo(
    () => ({
      a(props: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
        const { node: _node, children, href, ...rest } = props;
        const h = typeof href === "string" ? href.trim() : "";
        const canSave = showSave && isHttpUrl(h);
        const link = (
          <a
            {...rest}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all"
          >
            {children}
          </a>
        );
        if (!canSave) return link;
        return (
          <span className="inline-flex flex-wrap items-center gap-x-0.5 align-baseline max-w-full">
            {link}
            <SaveFilingLinkButton ticker={safeTicker} url={h} mode="saved-documents" />
          </span>
        );
      },
      img(props: ImgHTMLAttributes<HTMLImageElement> & { node?: unknown }) {
        const { node: _node, ...rest } = props;
        const src = String((rest as { src?: string }).src ?? "");
        const alt = String((rest as { alt?: string }).alt ?? "image");
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            {...rest}
            src={src}
            alt={alt}
            style={{
              maxWidth: "100%",
              height: "auto",
              borderRadius: 8,
              margin: "10px 0",
            }}
          />
        );
      },
      table(props: TableHTMLAttributes<HTMLTableElement> & { node?: unknown }) {
        const { node: _node, children, ...rest } = props;
        return (
          <div className="saved-rich-text-table-scroll">
            <table {...rest}>{children}</table>
          </div>
        );
      },
    }),
    [showSave, safeTicker]
  );

  const looksLikeHtml =
    /<!doctype html>|<html\b|<head\b|<body\b|<style\b|<table\b|<section\b|<div\b|<p\b|<img\b/i.test(content);

  if (looksLikeHtml) {
    ensureExternalLinksOpenInNewTab();
    const clean = DOMPurify.sanitize(content, {
      ADD_TAGS: ["style"],
      ADD_ATTR: ["style", "class", "id", "target", "rel"],
    });

    if (showSave) {
      return <SavedHtmlContentWithSaveButtons html={clean} ticker={safeTicker} />;
    }
    return <div className="saved-html-content" dangerouslySetInnerHTML={{ __html: clean }} />;
  }

  return (
    <div className="saved-rich-text">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkLinkify, remarkBreaks]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
