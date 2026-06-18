import type { IxbrlEbitdaReconciliation, IxbrlEbitdaTable } from "@/lib/sec-ixbrl-mdna-tables";

export type AdjustedEbitdaDisplaySource = "mdna" | "press_release";

export type AdjustedEbitdaDisplaySection = {
  source: AdjustedEbitdaDisplaySource;
  label: string;
  tables: IxbrlEbitdaTable[];
  secUrl?: string | null;
};

export type AdjustedEbitdaDisplay = {
  /** @deprecated Use `sections` — kept for callers that check a single source. */
  source: AdjustedEbitdaDisplaySource | null;
  status: IxbrlEbitdaReconciliation["status"];
  /** All tables (MD&A first, then press release). */
  tables: IxbrlEbitdaTable[];
  sections: AdjustedEbitdaDisplaySection[];
  supplementalSource?: IxbrlEbitdaReconciliation["supplementalSource"];
  suggestedPressRelease?: IxbrlEbitdaReconciliation["suggestedPressRelease"];
  nearby8KScan?: IxbrlEbitdaReconciliation["nearby8KScan"];
};

/** Split MD&A and press-release EBITDA tables into separate sections for display. */
export function resolveAdjustedEbitdaDisplay(
  ebitda?: IxbrlEbitdaReconciliation,
  opts?: { periodicSecUrl?: string | null; pressSecUrl?: string | null }
): AdjustedEbitdaDisplay {
  if (!ebitda) {
    return { source: null, status: "none", tables: [], sections: [] };
  }

  const mdnaTables = ebitda.tables.filter((t) => t.inMdna);
  const pressTables = ebitda.tables.filter((t) => !t.inMdna);
  const pressSecUrl =
    opts?.pressSecUrl ?? ebitda.supplementalSource?.primaryDocumentUrl ?? ebitda.suggestedPressRelease?.primaryDocumentUrl ?? null;

  const sections: AdjustedEbitdaDisplaySection[] = [];
  if (mdnaTables.length > 0) {
    sections.push({
      source: "mdna",
      label: "MD&A (inline XBRL)",
      tables: mdnaTables,
      secUrl: opts?.periodicSecUrl ?? null,
    });
  }
  if (pressTables.length > 0) {
    sections.push({
      source: "press_release",
      label: "Press release / earnings exhibit",
      tables: pressTables,
      secUrl: pressSecUrl,
    });
  }

  const allTables = [...mdnaTables, ...pressTables];
  const status =
    allTables.length > 0 ? "tables" : ebitda.status;

  const source: AdjustedEbitdaDisplaySource | null =
    mdnaTables.length > 0 && pressTables.length > 0
      ? null
      : mdnaTables.length > 0
        ? "mdna"
        : pressTables.length > 0
          ? "press_release"
          : null;

  return {
    source,
    status,
    tables: allTables,
    sections,
    supplementalSource: ebitda.supplementalSource,
    suggestedPressRelease: ebitda.suggestedPressRelease,
    nearby8KScan: ebitda.nearby8KScan,
  };
}
