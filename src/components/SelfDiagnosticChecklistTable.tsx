"use client";

import type { SelfDiagnosticCheckResult } from "@/lib/sec-self-diagnostic-checklist";
import { TOLERANCE_PCT_LABEL } from "@/lib/sec-xbrl-export-validation";

function statusLabel(status: SelfDiagnosticCheckResult["status"]): string {
  if (status === "pass") return "Ran — pass";
  if (status === "fail") return "Ran — fail";
  return "Not run";
}

function statusColor(status: SelfDiagnosticCheckResult["status"]): string {
  if (status === "pass") return "var(--ok, #3d9a5c)";
  if (status === "fail") return "var(--warn)";
  return "var(--muted2)";
}

export function SelfDiagnosticChecklistTable({
  checklist,
  compact = false,
}: {
  checklist: SelfDiagnosticCheckResult[];
  compact?: boolean;
}) {
  if (!checklist.length) return null;

  const ran = checklist.filter((c) => c.status !== "skipped").length;
  const skipped = checklist.length - ran;

  return (
    <div className={compact ? "mt-2" : "mt-3"}>
      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
        15 tie-out checks — {ran} ran, {skipped} not run
      </p>
      <div
        className="mt-1.5 overflow-x-auto rounded border"
        style={{ borderColor: "var(--border2)" }}
      >
        <table className="w-full min-w-[32rem] border-collapse text-left text-[11px]">
          <thead>
            <tr style={{ background: "var(--card2)", color: "var(--muted2)" }}>
              <th className="px-2 py-1.5 font-semibold w-8">#</th>
              <th className="px-2 py-1.5 font-semibold">Check</th>
              <th className="px-2 py-1.5 font-semibold w-28">Status</th>
              {!compact ? <th className="px-2 py-1.5 font-semibold w-24">Periods</th> : null}
              <th className="px-2 py-1.5 font-semibold">Note</th>
            </tr>
          </thead>
          <tbody>
            {checklist.map((c) => (
              <tr
                key={c.id}
                className="border-t"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              >
                <td className="px-2 py-1 font-mono text-[10px]" style={{ color: "var(--muted2)" }}>
                  {c.id}
                </td>
                <td className="px-2 py-1">{c.name}</td>
                <td className="px-2 py-1 font-medium" style={{ color: statusColor(c.status) }}>
                  {statusLabel(c.status)}
                </td>
                {!compact ? (
                  <td className="px-2 py-1 tabular-nums" style={{ color: "var(--muted2)" }}>
                    {c.status === "skipped"
                      ? "—"
                      : c.periodsFailed > 0
                        ? `${c.periodsFailed} fail / ${c.periodsChecked}`
                        : `${c.periodsChecked} ok`}
                  </td>
                ) : null}
                <td className="px-2 py-1 leading-snug" style={{ color: "var(--muted2)" }}>
                  {c.status === "skipped"
                    ? c.skipReason ?? "Required lines missing"
                    : c.periodsFailed > 0
                      ? `${c.periodsFailed} period(s) outside ${TOLERANCE_PCT_LABEL} tolerance`
                      : "Within tolerance"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
