"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, DataTable } from "@/components/ui";
import type { CapitalStructureSecurityDto } from "@/lib/capital-structure-securities";

type EditableField =
  | "name"
  | "cusip"
  | "instrumentType"
  | "lienLevel"
  | "coupon"
  | "price"
  | "yieldToMaturity"
  | "maturityLabel"
  | "faceAmount";

const FIELD_PLACEHOLDERS: Partial<Record<EditableField, string>> = {
  cusip: "Enter CUSIP",
  instrumentType: "Type",
  lienLevel: "Lien",
  coupon: "Coupon",
  price: "Price",
  yieldToMaturity: "YTM",
  maturityLabel: "Maturity",
  faceAmount: "Face",
};

async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      res.ok
        ? "Empty response from server — try restarting the dev server after pulling latest changes."
        : `Request failed (${res.status})`
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid server response (${res.status})`);
  }
}

function EditableSecurityCell({
  security,
  ticker,
  field,
  onUpdated,
  emphasize,
}: {
  security: CapitalStructureSecurityDto;
  ticker: string;
  field: EditableField;
  onUpdated: (security: CapitalStructureSecurityDto) => void;
  emphasize?: boolean;
}) {
  const rawValue =
    field === "maturityLabel"
      ? security.maturityLabel ?? security.maturityDate ?? ""
      : String(security[field] ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rawValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(rawValue);
  }, [rawValue]);

  async function save() {
    const trimmed = draft.trim();
    if (trimmed === rawValue.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/capital-structure-excel/${encodeURIComponent(ticker)}/securities/${encodeURIComponent(security.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: trimmed || null }),
        }
      );
      const body = await readJsonResponse<{ security?: CapitalStructureSecurityDto; error?: string }>(res);
      if (!res.ok || !body.security) throw new Error(body.error ?? "Failed to save.");
      onUpdated(body.security);
      setEditing(false);
    } catch {
      // keep editor open
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 min-w-[5rem]">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={FIELD_PLACEHOLDERS[field]}
          className="w-full min-w-[4.5rem] px-1.5 py-0.5 text-xs rounded border"
          style={{ borderColor: "var(--border2)", background: "var(--surface2)", color: "var(--text)" }}
          disabled={saving}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              setDraft(rawValue);
              setEditing(false);
            }
          }}
        />
        <button
          type="button"
          className="text-[10px] px-1 py-0.5 shrink-0"
          style={{ color: "var(--accent)" }}
          onClick={() => void save()}
          disabled={saving}
        >
          ✓
        </button>
      </div>
    );
  }

  const empty = !rawValue.trim();
  const display = empty ? (FIELD_PLACEHOLDERS[field] ?? "—") : rawValue;

  return (
    <button
      type="button"
      className="text-left text-xs w-full underline-offset-2 hover:underline truncate max-w-[14rem]"
      style={{
        color: empty ? "var(--muted2)" : emphasize && security.isConfirmed ? "var(--accent)" : "var(--text)",
      }}
      title={empty ? `Click to edit ${field}` : rawValue}
      onClick={() => setEditing(true)}
    >
      {display}
    </button>
  );
}

export function CapitalStructureSecuritiesPanel({
  ticker,
  latestExcelFilename,
  refreshKey,
}: {
  ticker: string;
  latestExcelFilename?: string | null;
  refreshKey?: string | number | null;
}) {
  const [securities, setSecurities] = useState<CapitalStructureSecurityDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ sheetName?: string | null; sourceExcelFile?: string | null }>({});

  const confirmedCount = useMemo(() => securities.filter((s) => s.isConfirmed).length, [securities]);

  const loadSecurities = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/capital-structure-excel/${encodeURIComponent(ticker)}/securities`);
      const body = await readJsonResponse<{
        securities?: CapitalStructureSecurityDto[];
        confirmedCount?: number;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(body.error ?? "Failed to load securities.");
      setSecurities(Array.isArray(body.securities) ? body.securities : []);
    } catch (e) {
      setSecurities([]);
      setStatus(e instanceof Error ? e.message : "Failed to load securities.");
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  const syncFromExcel = useCallback(async () => {
    if (!ticker) return;
    setSyncing(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/capital-structure-excel/${encodeURIComponent(ticker)}/securities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excelFilename: latestExcelFilename ?? null }),
      });
      const body = await readJsonResponse<{
        ok?: boolean;
        securities?: CapitalStructureSecurityDto[];
        sheetName?: string | null;
        sourceExcelFile?: string;
        parsedCount?: number;
        error?: string;
      }>(res);
      if (!res.ok || body.ok !== true) throw new Error(body.error ?? "Failed to sync securities.");
      setSecurities(Array.isArray(body.securities) ? body.securities : []);
      setMeta({ sheetName: body.sheetName, sourceExcelFile: body.sourceExcelFile });
      const confirmed = body.securities?.filter((s) => s.isConfirmed).length ?? 0;
      setStatus(
        `Extracted ${body.parsedCount ?? body.securities?.length ?? 0} rows from ${body.sheetName ? `"${body.sheetName}"` : "workbook"}. ${confirmed} confirmed security${confirmed === 1 ? "" : "ies"} saved.`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to sync securities.");
    } finally {
      setSyncing(false);
    }
  }, [ticker, latestExcelFilename]);

  useEffect(() => {
    void loadSecurities();
  }, [loadSecurities, refreshKey]);

  function handleSecurityUpdated(updated: CapitalStructureSecurityDto) {
    setSecurities((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    if (updated.isConfirmed) {
      setStatus(
        `Security confirmed: ${updated.name}${updated.cusip ? ` (${updated.cusip})` : ""} — saved for downstream analysis.`
      );
    }
  }

  return (
    <Card
      title="Securities"
      titleAside={
        <div className="flex items-center gap-2 shrink-0">
          {confirmedCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded" style={{ color: "var(--accent)", border: "1px solid var(--accent)" }}>
              {confirmedCount} confirmed
            </span>
          )}
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded"
            style={{ border: "1px solid var(--border2)", color: "var(--text)" }}
            onClick={() => void loadSecurities()}
            disabled={loading || syncing}
          >
            Refresh
          </button>
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded"
            style={{ border: "1px solid var(--accent)", color: "var(--accent)" }}
            onClick={() => void syncFromExcel()}
            disabled={loading || syncing || !latestExcelFilename}
            title={latestExcelFilename ? "Re-parse latest Excel workbook" : "Upload an Excel workbook first"}
          >
            {syncing ? "Syncing…" : "Sync from Excel"}
          </button>
        </div>
      }
    >
      <p className="text-xs mb-3 leading-relaxed" style={{ color: "var(--muted2)" }}>
        Only Excel rows with a CUSIP are imported as securities (bonds, notes, etc.). Term loans,
        revolvers, totals, and other lines without CUSIPs stay in the workbook but are not added here.
        Click any cell to edit; rows with a CUSIP are confirmed automatically and saved for downstream work.
      </p>
      {status && (
        <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
          {status}
        </p>
      )}
      {meta.sourceExcelFile && securities.length > 0 && (
        <p className="text-[10px] mb-2" style={{ color: "var(--muted2)" }}>
          Source: {meta.sourceExcelFile}
          {meta.sheetName ? ` · Sheet: ${meta.sheetName}` : ""}
        </p>
      )}
      {loading && securities.length === 0 ? (
        <p className="text-sm py-3" style={{ color: "var(--muted2)" }}>
          Loading securities…
        </p>
      ) : securities.length === 0 ? (
        <p className="text-sm py-3" style={{ color: "var(--muted2)" }}>
          {latestExcelFilename
            ? 'No securities yet. Click "Sync from Excel" to extract instruments from the workbook.'
            : "Upload a capital structure Excel file to generate securities."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <DataTable grid className="min-w-max w-full">
            <thead>
              <tr>
                <th className="w-6" />
                <th>Instrument</th>
                <th>CUSIP</th>
                <th>Type</th>
                <th>Lien</th>
                <th>Coupon</th>
                <th>Price</th>
                <th>YTM</th>
                <th>Maturity</th>
                <th>Face / Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {securities.map((row) => (
                <tr
                  key={row.id}
                  style={
                    row.isConfirmed
                      ? { background: "color-mix(in srgb, var(--accent) 6%, transparent)" }
                      : undefined
                  }
                >
                  <td className="text-center text-[10px]" title={row.isConfirmed ? "Confirmed security" : "Draft row"}>
                    {row.isConfirmed ? (
                      <span style={{ color: "var(--accent)" }}>●</span>
                    ) : (
                      <span style={{ color: "var(--muted2)" }}>○</span>
                    )}
                  </td>
                  <td>
                    <EditableSecurityCell security={row} ticker={ticker} field="name" onUpdated={handleSecurityUpdated} />
                  </td>
                  <td>
                    <EditableSecurityCell
                      security={row}
                      ticker={ticker}
                      field="cusip"
                      onUpdated={handleSecurityUpdated}
                      emphasize
                    />
                  </td>
                  <td>
                    <EditableSecurityCell security={row} ticker={ticker} field="instrumentType" onUpdated={handleSecurityUpdated} />
                  </td>
                  <td>
                    <EditableSecurityCell security={row} ticker={ticker} field="lienLevel" onUpdated={handleSecurityUpdated} />
                  </td>
                  <td>
                    <EditableSecurityCell security={row} ticker={ticker} field="coupon" onUpdated={handleSecurityUpdated} />
                  </td>
                  <td>
                    <EditableSecurityCell security={row} ticker={ticker} field="price" onUpdated={handleSecurityUpdated} />
                  </td>
                  <td>
                    <EditableSecurityCell security={row} ticker={ticker} field="yieldToMaturity" onUpdated={handleSecurityUpdated} />
                  </td>
                  <td>
                    <EditableSecurityCell security={row} ticker={ticker} field="maturityLabel" onUpdated={handleSecurityUpdated} />
                  </td>
                  <td>
                    <EditableSecurityCell security={row} ticker={ticker} field="faceAmount" onUpdated={handleSecurityUpdated} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}
    </Card>
  );
}
