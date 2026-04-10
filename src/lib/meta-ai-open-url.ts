/**
 * @deprecated Import from `@/lib/deepseek-open-url` instead. This file re-exports DeepSeek web-chat helpers under legacy names.
 */

export {
  DEEPSEEK_CHAT_ORIGIN as META_AI_NEW_CHAT_ORIGIN,
  DEEPSEEK_LONG_URL_NOTICE as META_AI_LONG_URL_NOTICE,
  deepSeekOpenStatusMessage as deepSeekOpenStatusMessage,
  buildDeepSeekNewChatUrl as buildMetaAiNewChatUrl,
  openDeepSeekNewChatWindow as openDeepSeekNewChatWindow,
  openDeepSeekWithClipboard as openDeepSeekWithClipboard,
} from "@/lib/deepseek-open-url";

/** Same text as ChatGPT long-URL notice (shared bulk/tab copy). */
export { CHATGPT_LONG_URL_NOTICE as CHATGPT_AND_META_LONG_URL_NOTICES } from "@/lib/chatgpt-open-url";
