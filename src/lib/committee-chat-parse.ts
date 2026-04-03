/**
 * Parse and validate AI Chat POST body messages (text + optional file attachments).
 */

import type { ChatConversationTurn, ChatUserContentPart } from "@/lib/chat-multimodal-types";

const MAX_MESSAGES = 48;
const MAX_TEXT_CHARS_PER_USER_MESSAGE = 100_000;
const MAX_ASSISTANT_CHARS = 200_000;
const MAX_ATTACHMENTS_PER_MESSAGE = 8;
/** ~4.8 MB raw file after base64 decode (approximate via base64 length). */
const MAX_BASE64_CHARS_PER_ATTACHMENT = 6_500_000;
const MAX_TOTAL_CONVERSATION_TEXT_CHARS = 400_000;

const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export type WireAttachment = {
  name?: string;
  mediaType: string;
  data: string;
};

export type WireUserMessage = {
  role: "user";
  content?: string;
  attachments?: WireAttachment[];
};

export type WireAssistantMessage = {
  role: "assistant";
  content: string;
};

export type WireMessage = WireUserMessage | WireAssistantMessage;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function wireUserToTurn(m: WireUserMessage): ChatConversationTurn | { error: string } {
  const text = typeof m.content === "string" ? m.content.trim() : "";
  const attachments = Array.isArray(m.attachments) ? m.attachments : [];

  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { error: `At most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message` };
  }

  const parts: ChatUserContentPart[] = [];

  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i];
    if (!isPlainObject(a)) return { error: "Invalid attachment" };
    const mediaType = typeof a.mediaType === "string" ? a.mediaType.trim().toLowerCase() : "";
    const data = typeof a.data === "string" ? a.data.replace(/\s/g, "") : "";
    if (!mediaType || !data) return { error: "Each attachment needs mediaType and base64 data" };
    if (data.length > MAX_BASE64_CHARS_PER_ATTACHMENT) {
      return { error: "One attachment is too large (max ~5 MB per file)" };
    }

    if (mediaType === "application/pdf") {
      parts.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
      });
    } else if (ALLOWED_IMAGE_MIME.has(mediaType)) {
      parts.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data },
      });
    } else {
      return {
        error: `Unsupported file type: ${mediaType}. Use PDF or images (JPEG, PNG, GIF, WebP), or paste text.`,
      };
    }
  }

  if (text.length > MAX_TEXT_CHARS_PER_USER_MESSAGE) {
    return { error: "Message text is too long" };
  }

  if (parts.length === 0) {
    if (!text) return { error: "Empty message content" };
    return { role: "user", content: text };
  }

  if (text) {
    parts.push({ type: "text", text });
  } else {
    parts.push({ type: "text", text: "Please analyze the attached file(s)." });
  }

  return { role: "user", content: parts };
}

export function parseCommitteeChatMessages(raw: unknown): ChatConversationTurn[] | { error: string } {
  if (!Array.isArray(raw)) return { error: "messages must be an array" };
  if (raw.length === 0) return { error: "messages must not be empty" };
  if (raw.length > MAX_MESSAGES) return { error: `At most ${MAX_MESSAGES} messages per request` };

  const out: ChatConversationTurn[] = [];
  let totalText = 0;

  for (const m of raw) {
    if (!isPlainObject(m)) return { error: "Invalid message entry" };
    const role = m.role;
    if (role === "assistant") {
      const content = typeof m.content === "string" ? m.content.trim() : "";
      if (!content) return { error: "Empty assistant message" };
      if (content.length > MAX_ASSISTANT_CHARS) return { error: "Assistant message too long" };
      totalText += content.length;
      if (totalText > MAX_TOTAL_CONVERSATION_TEXT_CHARS) return { error: "Conversation too long" };
      out.push({ role: "assistant", content });
      continue;
    }
    if (role === "user") {
      const wu: WireUserMessage = {
        role: "user",
        content: typeof m.content === "string" ? m.content : "",
        attachments: Array.isArray(m.attachments) ? (m.attachments as WireAttachment[]) : undefined,
      };
      const textLen = (wu.content ?? "").trim().length;
      totalText += textLen;
      const att = wu.attachments ?? [];
      for (const a of att) {
        if (a && typeof a.data === "string") totalText += Math.min(a.data.length, MAX_BASE64_CHARS_PER_ATTACHMENT);
      }
      if (totalText > MAX_TOTAL_CONVERSATION_TEXT_CHARS) return { error: "Conversation too long" };

      const textOnly = !att.length;
      if (textOnly) {
        const c = (wu.content ?? "").trim();
        if (!c) return { error: "Empty message content" };
        if (c.length > MAX_TEXT_CHARS_PER_USER_MESSAGE) return { error: "Message text is too long" };
        out.push({ role: "user", content: c });
        continue;
      }

      const turn = wireUserToTurn(wu);
      if ("error" in turn) return turn;
      out.push(turn);
      continue;
    }
    return { error: "Invalid message role" };
  }

  if (out[0].role !== "user") return { error: "First message must be from the user" };
  if (out[out.length - 1].role !== "user") return { error: "Last message must be from the user" };
  for (let i = 0; i < out.length; i++) {
    const want: "user" | "assistant" = i % 2 === 0 ? "user" : "assistant";
    if (out[i].role !== want) return { error: "Messages must alternate user and assistant" };
  }

  return out;
}
