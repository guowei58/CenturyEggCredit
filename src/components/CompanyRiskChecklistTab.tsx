"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { canAccessRiskChecklist } from "@/lib/risk-checklist/access";
import { classifyRiskScore, calculateQuestionPoints, isUnknownAnswer, riskClassificationColor } from "@/lib/risk-checklist/classification";
import { applyOptimisticAnswer, mergeSavedAnswerBatch, mergedQuestionIdsFromBatch } from "@/lib/risk-checklist/optimistic-workspace";
import type { RiskAnswerLabel, RiskClassification } from "@/lib/risk-checklist/types";
import { Card } from "@/components/ui";

type Workspace = {
  assessment: {
    id: string;
    status: string;
    isEditable: boolean;
    updatedAt: string;
    updatedBy: string | null;
    nextReviewDate: string | null;
    manualOverrideScore: number | null;
    manualOverrideClassification: string | null;
    manualOverrideReason: string | null;
    manualOverrideReviewDate: string | null;
  };
  scores: {
    finalScoreRounded: number;
    effectiveClassification: RiskClassification;
  };
  categories: Array<{
    key: string;
    label: string;
    maxPoints: number;
    earnedPoints: number;
    applicableMaxPoints: number;
    displayScoreRounded: number;
    unansweredCount: number;
  }>;
  questions: Array<{
    id: string;
    questionCode: string;
    category: string;
    categoryLabel: string;
    questionText: string;
    maxPoints: number;
    answerLabel: RiskAnswerLabel;
    calculatedPoints: number;
    metricValue: number | null;
    metricUnit: string | null;
    analystComment: string | null;
    sourceUrl: string | null;
    sourceDescription: string | null;
    isIncomplete: boolean;
    updatedAt: string | null;
  }>;
};

const ANSWER_OPTIONS: Array<{ value: RiskAnswerLabel; label: string }> = [
  { value: "no", label: "No" },
  { value: "mixed", label: "Mixed" },
  { value: "yes", label: "Yes" },
  { value: "unknown", label: "Unknown" },
  { value: "not_applicable", label: "N/A" },
];

function ScoreOutOf100({ score, large }: { score: number; large?: boolean }) {
  return (
    <>
      {score}
      <span
        className={`font-normal ${large ? "text-base" : "text-xs"}`}
        style={{ color: "var(--muted2)" }}
      >
        {" "}
        / 100
      </span>
    </>
  );
}

function HeaderMetricCard({
  label,
  value,
  subtext,
  valueColor = "var(--text)",
  subtextColor = "var(--muted)",
  largeValue = false,
}: {
  label: string;
  value: ReactNode;
  subtext?: ReactNode;
  valueColor?: string;
  subtextColor?: string;
  largeValue?: boolean;
}) {
  return (
    <div
      className="flex h-[5.5rem] w-[10.5rem] shrink-0 flex-col rounded border px-3 py-2"
      style={{ borderColor: "var(--border)", background: "var(--card2)" }}
    >
      <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }} title={label}>
        {label}
      </div>
      <div
        className={`mt-1 min-h-[2rem] font-mono font-semibold leading-tight ${largeValue ? "text-3xl" : "text-sm"}`}
        style={{ color: valueColor }}
      >
        {value}
      </div>
      <div className="mt-auto text-xs leading-tight" style={{ color: subtextColor }}>
        {subtext ?? "\u00a0"}
      </div>
    </div>
  );
}

function CategoryBucketBadge({ label, score }: { label: string; score: number }) {
  const classification = classifyRiskScore(score);
  const color = riskClassificationColor(classification);
  return (
    <div
      className="flex h-[5.5rem] w-[10.5rem] shrink-0 flex-col rounded border px-3 py-2"
      style={{ borderColor: "var(--border)", background: "var(--card2)" }}
    >
      <div className="truncate text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }} title={label}>
        {label}
      </div>
      <div className="mt-1 min-h-[2rem] font-mono text-lg font-semibold leading-tight" style={{ color }}>
        <ScoreOutOf100 score={score} />
      </div>
      <div className="mt-auto truncate text-xs leading-tight" style={{ color }}>
        {classification}
      </div>
    </div>
  );
}

function SegmentedAnswer({
  value,
  disabled,
  onChange,
}: {
  value: RiskAnswerLabel;
  disabled?: boolean;
  onChange: (v: RiskAnswerLabel) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {ANSWER_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className="rounded border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50"
          style={{
            borderColor: value === opt.value ? "var(--accent)" : "var(--border)",
            background: value === opt.value ? "color-mix(in srgb, var(--accent) 18%, var(--card))" : "var(--card)",
            color: value === opt.value ? "var(--accent)" : "var(--muted2)",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function CompanyRiskChecklistTab({ ticker }: { ticker: string }) {
  const { data: session, status } = useSession();
  const allowed = status === "authenticated" && canAccessRiskChecklist(session?.user?.email);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const workspaceRef = useRef<Workspace | null>(null);
  const saveQueueRef = useRef(Promise.resolve());
  const pendingSavesRef = useRef(0);
  const pendingAnswersRef = useRef<Map<string, RiskAnswerLabel>>(new Map());
  const inFlightAnswersRef = useRef<Map<string, RiskAnswerLabel>>(new Map());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGenRef = useRef(0);
  const [answerOverrides, setAnswerOverrides] = useState<Record<string, RiskAnswerLabel>>({});
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!allowed) return;
    const gen = ++loadGenRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/risk-checklist/${encodeURIComponent(ticker)}`, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Failed to load (${res.status})`);
      }
      const data = (await res.json()) as Workspace;
      if (gen !== loadGenRef.current) return;
      workspaceRef.current = data;
      pendingAnswersRef.current.clear();
      inFlightAnswersRef.current.clear();
      setAnswerOverrides({});
      setWorkspace(data);
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [allowed, ticker]);

  useEffect(() => {
    void load();
  }, [load]);

  const questionsByCategory = useMemo(() => {
    if (!workspace) return new Map<string, Workspace["questions"]>();
    const map = new Map<string, Workspace["questions"]>();
    for (const q of workspace.questions) {
      if (!map.has(q.category)) map.set(q.category, []);
      map.get(q.category)!.push(q);
    }
    return map;
  }, [workspace]);

  const displayAnswerLabel = useCallback(
    (questionId: string, saved: RiskAnswerLabel) => answerOverrides[questionId] ?? saved,
    [answerOverrides]
  );

  const flushPendingAnswers = useCallback(() => {
    if (pendingAnswersRef.current.size === 0) return;

    const batch = Array.from(pendingAnswersRef.current.entries());
    for (const [questionId] of batch) {
      pendingAnswersRef.current.delete(questionId);
    }
    for (const [questionId, answerLabel] of batch) {
      inFlightAnswersRef.current.set(questionId, answerLabel);
    }

    saveQueueRef.current = saveQueueRef.current
      .then(async () => {
        pendingSavesRef.current += 1;
        setSyncing(true);
        const res = await fetch(`/api/risk-checklist/${encodeURIComponent(ticker)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_draft",
            answers: batch.map(([questionId, answerLabel]) => ({ questionId, answerLabel })),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Save failed");
        }
        const server = (await res.json()) as Workspace;
        const stillPending = new Set(pendingAnswersRef.current.keys());
        const inFlight = new Map(inFlightAnswersRef.current);
        setWorkspace((prev) => {
          if (!prev) {
            workspaceRef.current = server;
            return server;
          }
          const next = mergeSavedAnswerBatch(prev, server, batch, stillPending, inFlight) as Workspace;
          const merged = {
            ...next,
            assessment: {
              ...next.assessment,
              updatedAt: server.assessment.updatedAt,
            },
          };
          workspaceRef.current = merged;
          return merged;
        });
        const confirmedIds = mergedQuestionIdsFromBatch(batch, stillPending, inFlight);
        if (confirmedIds.length > 0) {
          setAnswerOverrides((prev) => {
            const next = { ...prev };
            for (const questionId of confirmedIds) {
              delete next[questionId];
            }
            return next;
          });
        }
        if (pendingAnswersRef.current.size > 0) {
          if (flushTimerRef.current != null) clearTimeout(flushTimerRef.current);
          flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            flushPendingAnswers();
          }, 150);
        }
      })
      .catch((e) => {
        for (const [questionId, answerLabel] of batch) {
          pendingAnswersRef.current.set(questionId, answerLabel);
        }
        setError(e instanceof Error ? e.message : "Save failed");
      })
      .finally(() => {
        for (const [questionId] of batch) {
          inFlightAnswersRef.current.delete(questionId);
        }
        pendingSavesRef.current = Math.max(0, pendingSavesRef.current - 1);
        if (pendingSavesRef.current === 0) setSyncing(false);
      });
  }, [ticker]);

  const scheduleAnswerFlush = useCallback(() => {
    if (flushTimerRef.current != null) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flushPendingAnswers();
    }, 150);
  }, [flushPendingAnswers]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current != null) clearTimeout(flushTimerRef.current);
      const batch = Array.from(pendingAnswersRef.current.entries());
      if (batch.length === 0) return;
      pendingAnswersRef.current.clear();
      void fetch(`/api/risk-checklist/${encodeURIComponent(ticker)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          action: "save_draft",
          answers: batch.map(([questionId, answerLabel]) => ({ questionId, answerLabel })),
        }),
      });
    };
  }, [ticker]);

  const queueAnswerSave = useCallback(
    (questionId: string, answerLabel: RiskAnswerLabel) => {
      pendingAnswersRef.current.set(questionId, answerLabel);
      scheduleAnswerFlush();
    },
    [scheduleAnswerFlush]
  );

  const saveAnswer = useCallback(
    (questionId: string, answerLabel: RiskAnswerLabel) => {
      const prev = workspaceRef.current;
      if (!prev?.assessment.isEditable) return;
      if (prev.questions.find((q) => q.id === questionId)?.answerLabel === answerLabel) return;

      setError(null);
      const next = applyOptimisticAnswer(prev, questionId, answerLabel);
      workspaceRef.current = next;
      setWorkspace(next);
      setAnswerOverrides((prevOverrides) => ({ ...prevOverrides, [questionId]: answerLabel }));
      queueAnswerSave(questionId, answerLabel);
    },
    [queueAnswerSave]
  );

  if (!allowed) {
    return (
      <Card title="Risk Checklist">
        <p className="px-4 py-6 text-sm" style={{ color: "var(--muted2)" }}>
          Risk Checklist is not available for this account.
        </p>
      </Card>
    );
  }

  if (loading) {
    return <p className="text-sm" style={{ color: "var(--muted2)" }}>Loading risk checklist…</p>;
  }

  if (error && !workspace) {
    return <p className="text-sm" style={{ color: "var(--red, #ef4444)" }}>{error}</p>;
  }

  if (!workspace) return null;

  const editable = workspace.assessment.isEditable;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {error ? (
        <p className="rounded border px-3 py-2 text-xs" style={{ borderColor: "var(--red, #ef4444)", color: "var(--red, #ef4444)" }}>
          {error}
        </p>
      ) : null}

      <div className="flex min-w-0 flex-nowrap items-stretch gap-2 overflow-x-auto pb-1">
        <HeaderMetricCard
          label="Composite Risk Score"
          value={<ScoreOutOf100 score={workspace.scores.finalScoreRounded} large />}
          subtext={workspace.scores.effectiveClassification}
          valueColor={riskClassificationColor(workspace.scores.effectiveClassification)}
          subtextColor={riskClassificationColor(workspace.scores.effectiveClassification)}
          largeValue
        />
        {workspace.categories.map((cat) => (
          <CategoryBucketBadge key={cat.key} label={cat.label} score={cat.displayScoreRounded} />
        ))}
        <HeaderMetricCard
          label="Last Updated"
          value={new Date(workspace.assessment.updatedAt).toLocaleString()}
          subtext={
            <>
              {workspace.assessment.status}
              {syncing ? " · saving…" : ""}
            </>
          }
        />
      </div>

      {workspace.assessment.manualOverrideScore != null ? (
        <p className="text-xs" style={{ color: "var(--muted2)" }}>
          Manual override: {workspace.assessment.manualOverrideScore}
          {workspace.assessment.manualOverrideReason ? ` — ${workspace.assessment.manualOverrideReason}` : ""}
          {workspace.assessment.manualOverrideReviewDate
            ? ` (review ${new Date(workspace.assessment.manualOverrideReviewDate).toLocaleDateString()})`
            : ""}
        </p>
      ) : null}

      <div className="space-y-2">
        {workspace.categories.map((cat) => {
          const open = expandedCategories[cat.key] ?? true;
          const qs = questionsByCategory.get(cat.key) ?? [];
          return (
            <div key={cat.key} className="rounded border" style={{ borderColor: "var(--border)" }}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                style={{ background: "var(--card2)" }}
                onClick={() => setExpandedCategories((s) => ({ ...s, [cat.key]: !open }))}
              >
                <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{cat.label}</span>
                <span className="font-mono text-xs" style={{ color: "var(--muted2)" }}>
                  {cat.earnedPoints.toFixed(1)} / {cat.applicableMaxPoints || cat.maxPoints} pts · {cat.displayScoreRounded}% risk
                  {cat.unansweredCount > 0 ? ` · ${cat.unansweredCount} incomplete` : ""}
                </span>
              </button>
              {open ? (
                <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {qs.map((q) => {
                    const answerLabel = displayAnswerLabel(q.id, q.answerLabel);
                    return (
                      <div key={q.id} className="px-3 py-2">
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>{q.questionCode}</span>
                              {isUnknownAnswer(answerLabel) ? (
                                <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase" style={{ background: "#f59e0b22", color: "#f59e0b" }}>
                                  Incomplete
                                </span>
                              ) : null}
                            </div>
                            <p className="text-sm leading-snug" style={{ color: "var(--text)" }}>{q.questionText}</p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="font-mono text-xs" style={{ color: "var(--muted2)" }}>
                              {calculateQuestionPoints(q.maxPoints, answerLabel).toFixed(1)} / {q.maxPoints} pts
                            </span>
                            <SegmentedAnswer
                              value={answerLabel}
                              disabled={!editable}
                              onChange={(v) => saveAnswer(q.id, v)}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
