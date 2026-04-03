"use client";

import type { CSSProperties } from "react";
import { useRef } from "react";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read clipboard image"));
    reader.readAsDataURL(file);
  });
}

export function RichPasteTextarea({
  value,
  onChange,
  className,
  style,
  placeholder,
  maxImageBytes = 1_500_000,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  maxImageBytes?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const items = clipboardData.items;
    const imageItems = items
      ? Array.from(items).filter((it) => it.type.startsWith("image/")).slice(0, 6)
      : [];

    if (imageItems.length > 0) {
      // Convert clipboard images into markdown image tags so they persist in the saved response.
      e.preventDefault();
      try {
        const dataUrls: string[] = [];
        for (const it of imageItems) {
          const file = it.getAsFile();
          if (!file) continue;
          if (file.size > maxImageBytes) continue;
          dataUrls.push(await readFileAsDataUrl(file));
        }
        if (dataUrls.length === 0) return;

        const insert = `\n${dataUrls.map((d) => `![pasted image](${d})`).join("\n")}\n`;
        const el = textareaRef.current;
        const start = el?.selectionStart ?? value.length;
        const end = el?.selectionEnd ?? value.length;
        const next = value.slice(0, start) + insert + value.slice(end);
        onChange(next);

        requestAnimationFrame(() => {
          if (!textareaRef.current) return;
          const cursor = start + insert.length;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(cursor, cursor);
        });
      } catch {
        // If image conversion fails, fall back to default paste behavior.
      }
      return;
    }

    const textMarkdown = clipboardData.getData("text/markdown");
    if (textMarkdown && textMarkdown.trim().length > 0) {
      e.preventDefault();
      const el = textareaRef.current;
      const start = el?.selectionStart ?? value.length;
      const end = el?.selectionEnd ?? value.length;
      const next = value.slice(0, start) + textMarkdown + value.slice(end);
      onChange(next);
      return;
    }

    const html = clipboardData.getData("text/html");
    if (html && /<!doctype html>|<html\b|<head\b|<body\b/i.test(html)) {
      // Many AI report generators copy as full HTML documents; inserting that raw blob is unreadable.
      // Instead, store only <style> + <body> so our viewer can render it.
      e.preventDefault();
      try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const styleTags = Array.from(doc.querySelectorAll("style")).map((s) => s.outerHTML).join("");
        const bodyInner = doc.body ? doc.body.innerHTML : "";
        const cleaned = (styleTags + bodyInner).trim() || html;

        const el = textareaRef.current;
        const start = el?.selectionStart ?? value.length;
        const end = el?.selectionEnd ?? value.length;
        const next = value.slice(0, start) + cleaned + value.slice(end);
        onChange(next);
      } catch {
        // fall back to default paste
      }
    }
  }

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      style={style}
      onPaste={handlePaste}
    />
  );
}

