"use client";

import { useCallback, useMemo, useState } from "react";

type Row = Record<string, unknown>;

type EntryRow = {
  id: string;
  entityName: string;
  address: string;
  jurisdiction: string;
};

function newRow(): EntryRow {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    entityName: "",
    address: "",
    jurisdiction: "",
  };
}

export function ManualSubsidiaryEntryPanel({
  ticker,
  savedRows,
  onSaved,
}: {
  ticker: string;
  /** `EntityUniverseItem` rows with `primarySourceCategory === "user_added"` */
  savedRows?: Row[];
  onSaved?: () => void;
}) {
  const tk = ticker.trim().toUpperCase();
  const [rows, setRows] = useState<EntryRow[]>(() => [newRow(), newRow(), newRow()]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const tableShell = useMemo(
    () => "w-full border-collapse text-left text-[12px] text-[var(--text)]",
    []
  );

  const addRow = useCallback(() => {
    setRows((r) => [...r, newRow()]);
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((r) => (r.length <= 1 ? r : r.filter((x) => x.id !== id)));
  }, []);

  const save = useCallback(async () => {
    if (!tk) return;
    setBusy(true);
    setMsg(null);
    try {
      const entries = rows.map((r) => ({
        entityName: r.entityName,
        address: r.address,
        jurisdiction: r.jurisdiction,
      }));
      const res = await fetch(`/api/companies/${encodeURIComponent(tk)}/entity-universe/manual-subsidiaries`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
        created?: number;
        updated?: number;
      };
      if (!res.ok || j.ok !== true) {
        throw new Error(j.error || `Save failed (${res.status})`);
      }
      setMsg(typeof j.message === "string" ? j.message : "Saved.");
      if ((j.created ?? 0) + (j.updated ?? 0) > 0) {
        setRows([newRow(), newRow()]);
      }
      onSaved?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }, [tk, rows, onSaved]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-[var(--muted)]">
        Add legal entity names with principal or mailing addresses and formation jurisdiction (state / country). Saved rows are
        stored in your entity universe as user-added names and feed into the UCC debtor workflow.
      </p>

      {savedRows != null && savedRows.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted2)]">Already saved (manual)</div>
          <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--card)]/40">
            <table className={tableShell}>
              <thead>
                <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted2)]">
                  <th className="py-1 pr-2 pl-2">Entity</th>
                  <th className="py-1 pr-2">Jurisdiction</th>
                  <th className="py-1 pr-2">Address</th>
                </tr>
              </thead>
              <tbody>
                {savedRows.map((r) => (
                  <tr key={String(r.id)} className="border-b border-[var(--border)]/60 align-top">
                    <td className="py-1 pr-2 pl-2 max-w-[240px] whitespace-pre-wrap">{String(r.entityName ?? "")}</td>
                    <td className="py-1 pr-2 whitespace-nowrap">{String(r.jurisdiction ?? r.state ?? "—")}</td>
                    <td className="py-1 pr-2 max-w-[280px] whitespace-pre-wrap text-[11px]">
                      {String(r.principalOfficeAddress ?? r.mailingAddress ?? "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--card)]">
        <table className={tableShell}>
          <thead>
            <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted2)]">
              <th className="py-1 pr-2 pl-2">Legal entity name</th>
              <th className="py-1 pr-2">Address</th>
              <th className="py-1 pr-2">Jurisdiction</th>
              <th className="py-1 pr-2 w-10" aria-label="Remove row" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-[var(--border)]/60">
                <td className="py-1 pr-2 pl-2 p-0 align-top">
                  <input
                    className="w-full min-w-[160px] bg-transparent px-1 py-1 text-[12px] outline-none"
                    value={row.entityName}
                    onChange={(e) =>
                      setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, entityName: e.target.value } : x)))
                    }
                    placeholder="e.g. Example Holdings LLC"
                    autoComplete="organization"
                  />
                </td>
                <td className="py-1 pr-2 p-0 align-top">
                  <input
                    className="w-full min-w-[180px] bg-transparent px-1 py-1 text-[12px] outline-none"
                    value={row.address}
                    onChange={(e) =>
                      setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, address: e.target.value } : x)))
                    }
                    placeholder="Street, city, state, ZIP"
                    autoComplete="street-address"
                  />
                </td>
                <td className="py-1 pr-2 p-0 align-top">
                  <input
                    className="w-full min-w-[100px] bg-transparent px-1 py-1 text-[12px] outline-none"
                    value={row.jurisdiction}
                    onChange={(e) =>
                      setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, jurisdiction: e.target.value } : x)))
                    }
                    placeholder="DE, NY, England…"
                  />
                </td>
                <td className="py-1 pr-2 px-1 align-top text-center">
                  <button
                    type="button"
                    className="rounded px-1 text-[14px] leading-none text-[var(--muted)] hover:text-[var(--danger)]"
                    onClick={() => removeRow(row.id)}
                    aria-label="Remove row"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={addRow}
          disabled={busy}
          className="rounded border border-[var(--border)] bg-transparent px-3 py-1.5 text-[11px] font-semibold text-[var(--text)] disabled:opacity-50"
        >
          Add row
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !tk}
          className="rounded border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
          style={{ borderColor: "var(--accent)", background: "var(--accent)", color: "var(--bg)" }}
        >
          {busy ? "Saving…" : "Save subsidiaries"}
        </button>
        {msg ? <span className="text-[11px] text-[var(--muted)]">{msg}</span> : null}
      </div>
    </div>
  );
}
