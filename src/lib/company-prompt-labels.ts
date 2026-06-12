import {
  isPrivateWorkspaceKey,
  privateWorkspaceDisplayName,
} from "@/lib/company-workspace-key";

export type CompanyPromptContext = {
  workspaceKey: string;
  companyName?: string | null;
};

export type ResolvedCompanyPromptLabels = {
  workspaceKey: string;
  isPrivate: boolean;
  /** Human-readable company name for prompts and UI. */
  displayName: string;
  /**
   * Value for [TICKER] / {{TICKER}} placeholders.
   * Public filers: listed symbol. Private companies: company name (never PRIV… codes).
   */
  tickerForPrompt: string;
  /** Value for "Name (TICKER)" style placeholders. Private: name only. */
  parenLabel: string;
  /** Short line for earnings-style prompts when no SEC ticker exists. */
  earningsCompanyNameLine: string;
};

export function resolveCompanyPromptLabels(ctx: CompanyPromptContext): ResolvedCompanyPromptLabels {
  const workspaceKey = ctx.workspaceKey.trim();
  const storedName = ctx.companyName?.trim() ?? "";
  const isPrivate = isPrivateWorkspaceKey(workspaceKey);

  const displayName = isPrivate
    ? privateWorkspaceDisplayName(workspaceKey, storedName)
    : storedName || workspaceKey;

  if (isPrivate) {
    return {
      workspaceKey,
      isPrivate: true,
      displayName,
      tickerForPrompt: displayName,
      parenLabel: displayName,
      earningsCompanyNameLine: displayName,
    };
  }

  const tk = workspaceKey;
  const parenLabel =
    storedName && storedName.toUpperCase() !== tk.toUpperCase() ? `${storedName} (${tk})` : tk || displayName;
  const earningsCompanyNameLine =
    storedName && storedName.toUpperCase() !== tk.toUpperCase()
      ? storedName
      : "Not provided in app — infer from ticker, SEC, and IR.";

  return {
    workspaceKey,
    isPrivate: false,
    displayName,
    tickerForPrompt: tk,
    parenLabel,
    earningsCompanyNameLine,
  };
}

/** Replace common company/ticker placeholders using private-company-safe labels. */
export function fillCompanyPromptTemplate(
  template: string,
  workspaceKey: string,
  companyName?: string | null
): string {
  const labels = resolveCompanyPromptLabels({ workspaceKey, companyName });
  const { displayName, tickerForPrompt, parenLabel, earningsCompanyNameLine } = labels;
  const tickerSlashName = labels.isPrivate ? displayName : `${tickerForPrompt} / ${displayName}`;

  return template
    .replace(/\[COMPANY NAME\]/g, displayName)
    .replace(/\[INSERT COMPANY NAME\]/g, displayName)
    .replace(/\[INSERT COMPANY NAME IF KNOWN\]/g, displayName)
    .replace(/\[company name\]/gi, displayName)
    .replace(/\[TICKER\]/g, tickerForPrompt)
    .replace(/\[INSERT TICKER\]/g, tickerForPrompt)
    .replace(/\[ticker\]/gi, tickerForPrompt)
    .replace(/\{\{TICKER\}\}/g, tickerForPrompt)
    .replace(/\{\{COMPANY_NAME\}\}/g, earningsCompanyNameLine)
    .replace(/\[COMPANY NAME \/ TICKER\]/g, parenLabel)
    .replace(/\[TICKER \/ COMPANY NAME\]/g, tickerSlashName);
}
