/**
 * Multimodal chat turns for AI Chat (Claude + OpenAI). Server-only consumers import from here or anthropic.
 */

export type ChatImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
};

export type ChatPdfBlock = {
  type: "document";
  source: { type: "base64"; media_type: "application/pdf"; data: string };
};

export type ChatTextBlock = { type: "text"; text: string };

export type ChatUserContentPart = ChatTextBlock | ChatImageBlock | ChatPdfBlock;

/** One turn in committee / AI Chat conversation. */
export type ChatConversationTurn =
  | { role: "assistant"; content: string }
  | { role: "user"; content: string | ChatUserContentPart[] };

export function conversationHasPdf(messages: ChatConversationTurn[]): boolean {
  for (const m of messages) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") continue;
    for (const p of m.content) {
      if (p.type === "document") return true;
    }
  }
  return false;
}

/** True if any user turn includes images/PDFs (not plain text only). Local text models cannot consume these. */
export function conversationHasNonTextMultimodal(messages: ChatConversationTurn[]): boolean {
  for (const m of messages) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") continue;
    for (const p of m.content) {
      if (p.type !== "text") return true;
    }
  }
  return false;
}
