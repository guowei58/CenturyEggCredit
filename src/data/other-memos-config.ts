import type { SavedDataKey } from "@/lib/saved-ticker-data";
import type { WorkProductPromptKind } from "@/lib/work-product-prompt-build";

export type OtherMemoTabId =
  | "literary-references"
  | "biblical-references"
  | "shorting-at-50c"
  | "next-quarter-earnings-transcript";

export type OtherMemoTabConfig = {
  tabId: OtherMemoTabId;
  kind: WorkProductPromptKind;
  title: string;
  savedContentKey: SavedDataKey;
  emptyOutputMessage: string;
};

export const OTHER_MEMO_TAB_IDS: OtherMemoTabId[] = [
  "literary-references",
  "biblical-references",
  "shorting-at-50c",
  "next-quarter-earnings-transcript",
];

export const OTHER_MEMOS_SHARED_API_PATH = "/api/creative-workspace/other-memos";

export const OTHER_MEMO_CONFIGS: Record<OtherMemoTabId, OtherMemoTabConfig> = {
  "literary-references": {
    tabId: "literary-references",
    kind: "literary",
    title: "Literary References",
    savedContentKey: "literary-references-latest",
    emptyOutputMessage:
      "No saved literary references yet. Build the context window, run the model, then paste or save the response here.",
  },
  "biblical-references": {
    tabId: "biblical-references",
    kind: "biblical",
    title: "Biblical References",
    savedContentKey: "biblical-references-latest",
    emptyOutputMessage:
      "No saved biblical references yet. Build the context window, run the model, then paste or save the response here.",
  },
  "shorting-at-50c": {
    tabId: "shorting-at-50c",
    kind: "dumbass",
    title: "Shorting at 50c",
    savedContentKey: "how-to-look-like-a-dumbass-latest",
    emptyOutputMessage:
      "No saved short thesis yet. Build the context window, run the model, then paste or save the response here.",
  },
  "next-quarter-earnings-transcript": {
    tabId: "next-quarter-earnings-transcript",
    kind: "earnings-transcript",
    title: "Next Quarter Earnings Transcript",
    savedContentKey: "next-quarter-earnings-transcript-latest",
    emptyOutputMessage:
      "No saved earnings transcript draft yet. Build the context window, run the model, then paste or save the response here.",
  },
};

export function resolveOtherMemoTabId(tabId: string): OtherMemoTabId | null {
  if (tabId === "how-to-look-like-a-dumbass") return "shorting-at-50c";
  if (tabId in OTHER_MEMO_CONFIGS) return tabId as OtherMemoTabId;
  return null;
}
