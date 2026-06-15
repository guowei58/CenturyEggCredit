"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ensurePeriodFinancialsBatchSave,
  getPeriodFinancialsBatchSnapshot,
  periodFinancialsBatchFingerprint,
  resumePeriodFinancialsBatchPolling,
  subscribePeriodFinancialsBatchSave,
  type PeriodFinancialsBatchJobSnapshot,
} from "@/lib/period-financials-batch-save-runner";
import type { PeriodFinancialsFilingLabelRow } from "@/lib/period-financials-roic";

export function usePeriodFinancialsBackgroundBatchSave(opts: {
  ticker: string;
  filings: PeriodFinancialsFilingLabelRow[];
  companyName?: string;
  cik?: string;
}): {
  job: PeriodFinancialsBatchJobSnapshot;
  startBatchSave: (startOpts?: { force?: boolean }) => void;
} {
  const sym = opts.ticker.trim().toUpperCase();
  const fingerprint = useMemo(
    () => (opts.filings.length > 0 ? periodFinancialsBatchFingerprint(opts.filings) : ""),
    [opts.filings]
  );

  const [job, setJob] = useState<PeriodFinancialsBatchJobSnapshot>(() =>
    getPeriodFinancialsBatchSnapshot(sym, fingerprint)
  );

  const filingsRef = useRef(opts.filings);
  filingsRef.current = opts.filings;
  const companyNameRef = useRef(opts.companyName);
  companyNameRef.current = opts.companyName;
  const cikRef = useRef(opts.cik);
  cikRef.current = opts.cik;

  useEffect(() => {
    setJob(getPeriodFinancialsBatchSnapshot(sym, fingerprint));
    resumePeriodFinancialsBatchPolling(sym, fingerprint);
  }, [sym, fingerprint]);

  useEffect(() => {
    return subscribePeriodFinancialsBatchSave((next) => {
      if (next.ticker !== sym) return;
      if (fingerprint && next.fingerprint !== fingerprint) return;
      setJob(next);
    });
  }, [sym, fingerprint]);

  const startBatchSave = useCallback(
    (startOpts?: { force?: boolean }) => {
      if (!sym || !fingerprint || filingsRef.current.length === 0) return;
      ensurePeriodFinancialsBatchSave({
        ticker: sym,
        filings: filingsRef.current,
        companyName: companyNameRef.current,
        cik: cikRef.current,
        force: startOpts?.force,
      });
    },
    [sym, fingerprint]
  );

  return { job, startBatchSave };
}
