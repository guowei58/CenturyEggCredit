"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { pmDashboardTabIds } from "@/lib/tabs";
import { pmDashboardTabs } from "@/data/mock";
import { Card, DataTable, TabBar } from "@/components/ui";
import { classifyRiskScore, classificationFloorScore, riskClassificationColor } from "@/lib/risk-checklist/classification";
import {
  CATEGORY_LABELS,
  ISSUER_RISK_BUCKET_KEYS,
  ISSUER_RISK_BUCKET_SHORT_LABELS,
} from "@/lib/risk-checklist/seed-data";
import type { RiskAnswerLabel, RiskClassification } from "@/lib/risk-checklist/types";

type RiskBucketMatrixCell = {
  answerLabel: RiskAnswerLabel;
  pointsEarned: number;
  maxPoints: number;
  scorePercent: number;
};

type RiskBucketQuestionMatrix = {
  category: (typeof ISSUER_RISK_BUCKET_KEYS)[number];
  categoryLabel: string;
  questions: Array<{
    questionCode: string;
    questionText: string;
    shortLabel: string;
    maxPoints: number;
  }>;
  companies: Array<{
    ticker: string;
    companyName: string;
  }>;
  cells: Record<string, Record<string, RiskBucketMatrixCell | null>>;
};

type BucketColumn = (typeof ISSUER_RISK_BUCKET_KEYS)[number];

const ANSWER_LABELS: Record<RiskAnswerLabel, string> = {
  no: "No",
  mixed: "Mixed",
  yes: "Yes",
  unknown: "Unknown",
  not_applicable: "N/A",
};

type RiskPortfolioRow = {
  ticker: string;
  companyName: string;
  compositeScore: number;
  classification: string;
  buckets: Record<(typeof ISSUER_RISK_BUCKET_KEYS)[number], number>;
  lastUpdated: string;
  status: string;
};

type SortDirection = "asc" | "desc";

type RiskSortColumn =
  | "companyName"
  | "compositeScore"
  | (typeof ISSUER_RISK_BUCKET_KEYS)[number]
  | "classification"
  | "lastUpdated"
  | `question:${string}`;

function isBucketSortColumn(column: RiskSortColumn): column is (typeof ISSUER_RISK_BUCKET_KEYS)[number] {
  return (ISSUER_RISK_BUCKET_KEYS as readonly string[]).includes(column);
}

function isQuestionSortColumn(column: RiskSortColumn): column is `question:${string}` {
  return column.startsWith("question:");
}

function questionSortColumn(questionCode: string): RiskSortColumn {
  return `question:${questionCode}`;
}

function matrixCellSortValue(cell: RiskBucketMatrixCell | null | undefined): number {
  if (!cell) return -1;
  if (cell.answerLabel === "not_applicable") return -2;
  return cell.scorePercent;
}

function compareRiskRows(
  a: RiskPortfolioRow,
  b: RiskPortfolioRow,
  column: RiskSortColumn,
  direction: SortDirection,
  matrix: RiskBucketQuestionMatrix | null
): number {
  const sign = direction === "asc" ? 1 : -1;

  let cmp = 0;
  if (isQuestionSortColumn(column)) {
    const questionCode = column.slice("question:".length);
    const aVal = matrixCellSortValue(matrix?.cells[a.ticker]?.[questionCode]);
    const bVal = matrixCellSortValue(matrix?.cells[b.ticker]?.[questionCode]);
    cmp = aVal - bVal;
  } else switch (column) {
    case "companyName":
      cmp = a.companyName.localeCompare(b.companyName, undefined, { sensitivity: "base" });
      break;
    case "compositeScore":
      cmp = a.compositeScore - b.compositeScore;
      break;
    case "classification":
      cmp =
        classificationFloorScore(a.classification as RiskClassification) -
        classificationFloorScore(b.classification as RiskClassification);
      break;
    case "lastUpdated":
      cmp = new Date(a.lastUpdated).getTime() - new Date(b.lastUpdated).getTime();
      break;
    default:
      if (isBucketSortColumn(column)) {
        cmp = a.buckets[column] - b.buckets[column];
      }
      break;
  }

  if (cmp !== 0) return cmp * sign;
  return a.companyName.localeCompare(b.companyName, undefined, { sensitivity: "base" }) * sign;
}

function SortableHeaderContent({
  label,
  column,
  sortColumn,
  sortDirection,
  onSort,
  align = "left",
}: {
  label: string;
  column: RiskSortColumn;
  sortColumn: RiskSortColumn;
  sortDirection: SortDirection;
  onSort: (column: RiskSortColumn) => void;
  align?: "left" | "right";
}) {
  const active = sortColumn === column;

  return (
    <button
      type="button"
      className={`inline-flex w-full items-center gap-1 bg-transparent p-0 text-[10px] font-semibold uppercase tracking-wide hover:opacity-80 ${
        align === "right" ? "justify-end" : "justify-start"
      }`}
      style={{ color: active ? "var(--text)" : "var(--muted)", cursor: "pointer" }}
      onClick={() => onSort(column)}
    >
      <span>{label}</span>
      <span className="font-mono text-[11px] leading-none" style={{ color: active ? "var(--accent)" : "var(--muted2)" }}>
        {active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );
}

function SortableHeader({
  label,
  column,
  sortColumn,
  sortDirection,
  onSort,
  align = "left",
}: {
  label: string;
  column: RiskSortColumn;
  sortColumn: RiskSortColumn;
  sortDirection: SortDirection;
  onSort: (column: RiskSortColumn) => void;
  align?: "left" | "right";
}) {
  const active = sortColumn === column;
  const ariaSort = active ? (sortDirection === "asc" ? "ascending" : "descending") : "none";

  return (
    <th className={align === "right" ? "text-right" : undefined} aria-sort={ariaSort}>
      <SortableHeaderContent
        label={label}
        column={column}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSort={onSort}
        align={align}
      />
    </th>
  );
}

function BucketExpandHint({
  bucket,
  onDrillDown,
}: {
  bucket: BucketColumn;
  onDrillDown: (bucket: BucketColumn) => void;
}) {
  return (
    <th className="risk-bucket-expand-hint">
      <button
        type="button"
        className="mx-auto block bg-transparent p-0 text-[9px] font-normal normal-case tracking-normal hover:underline"
        style={{ color: "var(--muted2)", cursor: "pointer" }}
        title={`Expand ${CATEGORY_LABELS[bucket]} questions`}
        onClick={() => onDrillDown(bucket)}
      >
        Expand
      </button>
    </th>
  );
}

function BucketMinimizeHint({
  bucket,
  colSpan,
  onDrillDown,
}: {
  bucket: BucketColumn;
  colSpan: number;
  onDrillDown: (bucket: BucketColumn) => void;
}) {
  return (
    <th
      colSpan={colSpan}
      className="risk-bucket-expand-hint risk-bucket-minimize-hint"
      style={{
        borderLeft: "2px solid color-mix(in srgb, var(--accent) 45%, var(--border))",
        background: "color-mix(in srgb, var(--accent) 8%, var(--card2))",
      }}
    >
      <button
        type="button"
        className="mx-auto block bg-transparent p-0 text-[9px] font-normal normal-case tracking-normal hover:underline"
        style={{ color: "var(--accent)", cursor: "pointer" }}
        title={`Minimize ${CATEGORY_LABELS[bucket]} questions`}
        onClick={() => onDrillDown(bucket)}
      >
        Minimize
      </button>
    </th>
  );
}

function BucketSortableHeader({
  bucket,
  sortColumn,
  sortDirection,
  drillBucket,
  onSort,
  onDrillDown,
}: {
  bucket: BucketColumn;
  sortColumn: RiskSortColumn;
  sortDirection: SortDirection;
  drillBucket: BucketColumn | null;
  onSort: (column: RiskSortColumn) => void;
  onDrillDown: (bucket: BucketColumn) => void;
}) {
  const label = ISSUER_RISK_BUCKET_SHORT_LABELS[bucket];
  const active = sortColumn === bucket;
  const drilled = drillBucket === bucket;
  const ariaSort = active ? (sortDirection === "asc" ? "ascending" : "descending") : "none";

  return (
    <th className="risk-bucket-label-th text-right" aria-sort={ariaSort}>
      <div
        className={`inline-flex w-full items-center justify-end gap-1 ${drilled ? "rounded px-1" : ""}`}
        style={drilled ? { background: "color-mix(in srgb, var(--accent) 14%, transparent)" } : undefined}
      >
        <button
          type="button"
          className="bg-transparent p-0 text-[10px] font-semibold uppercase tracking-wide hover:underline"
          style={{ color: drilled ? "var(--accent)" : active ? "var(--text)" : "var(--muted)", cursor: "pointer" }}
          title={`${drilled ? "Collapse" : "Expand"} ${CATEGORY_LABELS[bucket]} questions`}
          onClick={() => onDrillDown(bucket)}
        >
          {label}
        </button>
        <button
          type="button"
          className="bg-transparent p-0 font-mono text-[11px] leading-none hover:opacity-80"
          style={{ color: active ? "var(--accent)" : "var(--muted2)", cursor: "pointer" }}
          aria-label={`Sort by ${label}`}
          onClick={() => onSort(bucket)}
        >
          {active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
        </button>
      </div>
    </th>
  );
}

function QuestionSortableHeader({
  questionCode,
  shortLabel,
  questionText,
  sortColumn,
  sortDirection,
  onSort,
  isFirst,
}: {
  questionCode: string;
  shortLabel: string;
  questionText: string;
  sortColumn: RiskSortColumn;
  sortDirection: SortDirection;
  onSort: (column: RiskSortColumn) => void;
  isFirst?: boolean;
}) {
  const column = questionSortColumn(questionCode);
  const active = sortColumn === column;
  const ariaSort = active ? (sortDirection === "asc" ? "ascending" : "descending") : "none";

  return (
    <th
      className="risk-question-th"
      aria-sort={ariaSort}
      style={
        isFirst
          ? {
              borderLeft: "2px solid color-mix(in srgb, var(--accent) 45%, var(--border))",
              background: "color-mix(in srgb, var(--accent) 6%, var(--card2))",
            }
          : { background: "color-mix(in srgb, var(--accent) 6%, var(--card2))" }
      }
    >
      <button
        type="button"
        className="mx-auto inline-flex max-w-full items-center justify-center gap-0.5 bg-transparent p-0 hover:opacity-80"
        style={{ color: active ? "var(--text)" : "var(--muted)", cursor: "pointer" }}
        title={questionText}
        onClick={() => onSort(column)}
      >
        <span className="whitespace-normal text-center text-[9px] font-normal normal-case leading-tight">
          {shortLabel}
        </span>
        <span
          className="shrink-0 self-center font-mono text-[10px] leading-none"
          style={{ color: active ? "var(--accent)" : "var(--muted2)" }}
        >
          {active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

function MatrixAnswerCell({ cell }: { cell: RiskBucketMatrixCell | null }) {
  if (!cell) {
    return <span style={{ color: "var(--muted2)" }}>—</span>;
  }

  if (cell.answerLabel === "not_applicable") {
    return <span className="text-[10px] font-medium" style={{ color: "var(--muted2)" }}>N/A</span>;
  }

  const color = riskClassificationColor(classifyRiskScore(cell.scorePercent));
  return (
    <span className="text-[10px] font-medium" style={{ color }}>
      {ANSWER_LABELS[cell.answerLabel]}
    </span>
  );
}

const RISK_SCORING_COL_WIDTH = {
  company: "10.5rem",
  composite: "6.5rem",
  bucket: "6.5rem",
  question: "5.5rem",
  classification: "9rem",
  lastUpdated: "10.5rem",
} as const;

function RiskScoringColgroup({
  drillBucket,
  matrix,
  matrixLoading,
}: {
  drillBucket: BucketColumn | null;
  matrix: RiskBucketQuestionMatrix | null;
  matrixLoading?: boolean;
}) {
  return (
    <colgroup>
      <col style={{ width: RISK_SCORING_COL_WIDTH.company }} />
      <col style={{ width: RISK_SCORING_COL_WIDTH.composite }} />
      {ISSUER_RISK_BUCKET_KEYS.flatMap((key) => {
        if (key === drillBucket) {
          if (matrix?.questions.length) {
            return matrix.questions.map((q) => (
              <col key={q.questionCode} style={{ width: RISK_SCORING_COL_WIDTH.question }} />
            ));
          }
          return [
            <col
              key={key}
              style={{ width: matrixLoading ? RISK_SCORING_COL_WIDTH.question : RISK_SCORING_COL_WIDTH.bucket }}
            />,
          ];
        }
        return [<col key={key} style={{ width: RISK_SCORING_COL_WIDTH.bucket }} />];
      })}
      <col style={{ width: RISK_SCORING_COL_WIDTH.classification }} />
      <col style={{ width: RISK_SCORING_COL_WIDTH.lastUpdated }} />
    </colgroup>
  );
}

function bucketBodyCells(
  key: BucketColumn,
  row: RiskPortfolioRow,
  drillBucket: BucketColumn | null,
  matrix: RiskBucketQuestionMatrix | null,
  matrixLoading: boolean
) {
  if (drillBucket === key && matrix) {
    return matrix.questions.map((q, i) => (
      <td
        key={q.questionCode}
        className="risk-question-td text-right"
        style={
          i === 0
            ? { borderLeft: "2px solid color-mix(in srgb, var(--accent) 45%, var(--border))" }
            : undefined
        }
      >
        <MatrixAnswerCell cell={matrix.cells[row.ticker]?.[q.questionCode] ?? null} />
      </td>
    ));
  }

  if (drillBucket === key && matrixLoading) {
    return (
      <td key={key} className="text-center text-[10px]" style={{ color: "var(--muted2)" }}>
        …
      </td>
    );
  }

  return (
    <td key={key} className="text-right">
      <BucketScore score={row.buckets[key]} />
    </td>
  );
}

const pmTabs = pmDashboardTabs.map((label, i) => ({
  id: pmDashboardTabIds[i],
  label,
}));

const PM_TABS_UNDER_TRAINING = new Set([
  "screeners",
  "relative-value",
  "distressed",
  "portfolio",
  "technicals",
  "ideas-alerts",
]);

function OreoTrainingPlaceholder({ title }: { title: string }) {
  return (
    <Card title={title}>
      <p className="px-4 py-12 text-center text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
        OREO is undergoing training. please check back.
      </p>
    </Card>
  );
}

export function PMDashboard({
  activeTab,
  onTabChange,
  onTickerSelect,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onTickerSelect?: (ticker: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TabBar
        tabs={pmTabs}
        activeId={activeTab}
        onSelect={(id) => onTabChange(id)}
        variant="pm"
      />
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <PMTabContent tabId={activeTab} onTickerSelect={onTickerSelect} />
      </div>
    </div>
  );
}

function BucketScore({ score }: { score: number }) {
  const classification = classifyRiskScore(score);
  const color = riskClassificationColor(classification);
  return (
    <span className="font-mono" style={{ color }}>
      {score}
      <span className="text-[10px] font-normal" style={{ color: "var(--muted2)" }}>
        {" "}
        / 100
      </span>
    </span>
  );
}

function RiskWatchlistTab({ onTickerSelect }: { onTickerSelect?: (ticker: string) => void }) {
  const [rows, setRows] = useState<RiskPortfolioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortColumn, setSortColumn] = useState<RiskSortColumn>("companyName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [drillBucket, setDrillBucket] = useState<BucketColumn | null>(null);
  const [matrix, setMatrix] = useState<RiskBucketQuestionMatrix | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);

  const handleSort = useCallback((column: RiskSortColumn) => {
    if (sortColumn === column) {
      setSortDirection((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDirection("asc");
  }, [sortColumn]);

  const handleDrillDown = useCallback((bucket: BucketColumn) => {
    setDrillBucket((prev) => {
      const next = prev === bucket ? null : bucket;
      if (next !== prev && isQuestionSortColumn(sortColumn)) {
        setSortColumn("companyName");
        setSortDirection("asc");
      }
      return next;
    });
  }, [sortColumn]);

  const sortedRows = useMemo(
    () => rows.slice().sort((a, b) => compareRiskRows(a, b, sortColumn, sortDirection, matrix)),
    [rows, sortColumn, sortDirection, matrix]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/risk-checklist/watchlist", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { rows?: RiskPortfolioRow[] };
        setRows(data.rows ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!drillBucket) {
      setMatrix(null);
      return;
    }

    let cancelled = false;
    setMatrixLoading(true);
    void fetch(`/api/risk-checklist/bucket-matrix?category=${encodeURIComponent(drillBucket)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load bucket detail");
        return (await res.json()) as RiskBucketQuestionMatrix;
      })
      .then((data) => {
        if (!cancelled) setMatrix(data);
      })
      .catch(() => {
        if (!cancelled) setMatrix(null);
      })
      .finally(() => {
        if (!cancelled) setMatrixLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [drillBucket]);

  const tableColSpan =
    ISSUER_RISK_BUCKET_KEYS.length +
    4 +
    (drillBucket && matrix ? matrix.questions.length - 1 : 0);

  return (
    <Card title="Risk Scoring">
      {loading ? (
        <p className="px-2 text-sm" style={{ color: "var(--muted2)" }}>Loading…</p>
      ) : (
        <div className="overflow-x-auto">
        <DataTable grid className={`min-w-max${drillBucket ? " risk-scoring-table-expanded" : ""}`}>
          <RiskScoringColgroup drillBucket={drillBucket} matrix={matrix} matrixLoading={matrixLoading} />
          <thead>
            {drillBucket ? (
              <>
                <tr>
                  <th rowSpan={2}>
                    <SortableHeaderContent
                      label="Company"
                      column="companyName"
                      sortColumn={sortColumn}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  </th>
                  <th rowSpan={2} className="text-right">
                    <SortableHeaderContent
                      label="Composite"
                      column="compositeScore"
                      sortColumn={sortColumn}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      align="right"
                    />
                  </th>
                  {ISSUER_RISK_BUCKET_KEYS.map((key) => {
                    if (key === drillBucket) {
                      const colSpan = matrix?.questions.length ?? 1;
                      return (
                        <BucketMinimizeHint
                          key={key}
                          bucket={key}
                          colSpan={colSpan}
                          onDrillDown={handleDrillDown}
                        />
                      );
                    }
                    return <BucketExpandHint key={key} bucket={key} onDrillDown={handleDrillDown} />;
                  })}
                  <th rowSpan={2} className="text-right">
                    <SortableHeaderContent
                      label="Classification"
                      column="classification"
                      sortColumn={sortColumn}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      align="right"
                    />
                  </th>
                  <th rowSpan={2} className="text-right">
                    <SortableHeaderContent
                      label="Last Updated"
                      column="lastUpdated"
                      sortColumn={sortColumn}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      align="right"
                    />
                  </th>
                </tr>
                <tr>
                  {ISSUER_RISK_BUCKET_KEYS.map((key) => {
                    if (key === drillBucket) {
                      if (matrixLoading && !matrix) {
                        return (
                          <th
                            key={key}
                            className="text-center text-[10px] font-normal normal-case"
                            style={{ color: "var(--muted2)" }}
                          >
                            …
                          </th>
                        );
                      }
                      return matrix?.questions.map((q, i) => (
                        <QuestionSortableHeader
                          key={q.questionCode}
                          questionCode={q.questionCode}
                          shortLabel={q.shortLabel}
                          questionText={q.questionText}
                          sortColumn={sortColumn}
                          sortDirection={sortDirection}
                          onSort={handleSort}
                          isFirst={i === 0}
                        />
                      ));
                    }
                    return (
                      <BucketSortableHeader
                        key={key}
                        bucket={key}
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        drillBucket={drillBucket}
                        onSort={handleSort}
                        onDrillDown={handleDrillDown}
                      />
                    );
                  })}
                </tr>
              </>
            ) : (
              <>
                <tr>
                  <th rowSpan={2}>
                    <SortableHeaderContent
                      label="Company"
                      column="companyName"
                      sortColumn={sortColumn}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  </th>
                  <th rowSpan={2} className="text-right">
                    <SortableHeaderContent
                      label="Composite"
                      column="compositeScore"
                      sortColumn={sortColumn}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      align="right"
                    />
                  </th>
                  {ISSUER_RISK_BUCKET_KEYS.map((key) => (
                    <BucketExpandHint key={key} bucket={key} onDrillDown={handleDrillDown} />
                  ))}
                  <th rowSpan={2} className="text-right">
                    <SortableHeaderContent
                      label="Classification"
                      column="classification"
                      sortColumn={sortColumn}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      align="right"
                    />
                  </th>
                  <th rowSpan={2} className="text-right">
                    <SortableHeaderContent
                      label="Last Updated"
                      column="lastUpdated"
                      sortColumn={sortColumn}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      align="right"
                    />
                  </th>
                </tr>
                <tr>
                  {ISSUER_RISK_BUCKET_KEYS.map((key) => (
                    <BucketSortableHeader
                      key={key}
                      bucket={key}
                      sortColumn={sortColumn}
                      sortDirection={sortDirection}
                      drillBucket={drillBucket}
                      onSort={handleSort}
                      onDrillDown={handleDrillDown}
                    />
                  ))}
                </tr>
              </>
            )}
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={tableColSpan} style={{ color: "var(--muted2)" }}>
                  No risk scores yet. Complete a Risk Checklist on a company to see it here.
                </td>
              </tr>
            ) : (
              sortedRows.map((r) => (
                <tr key={r.ticker}>
                  <td>
                    <button
                      type="button"
                      className="text-left underline-offset-2 hover:underline"
                      style={{ color: "var(--accent)" }}
                      title={r.ticker}
                      onClick={() => onTickerSelect?.(r.ticker)}
                    >
                      {r.companyName}
                    </button>
                  </td>
                  <td className="text-right">
                    <BucketScore score={r.compositeScore} />
                  </td>
                  {ISSUER_RISK_BUCKET_KEYS.flatMap((key) =>
                    bucketBodyCells(key, r, drillBucket, matrix, matrixLoading)
                  )}
                  <td className="text-right" style={{ color: riskClassificationColor(r.classification as RiskClassification) }}>
                    {r.classification}
                  </td>
                  <td className="text-right" style={{ color: "var(--muted2)" }}>
                    {new Date(r.lastUpdated).toLocaleDateString()}
                    <span className="ml-1 text-[10px] uppercase">{r.status}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
        </div>
      )}
    </Card>
  );
}

function PMTabContent({ tabId, onTickerSelect }: { tabId: string; onTickerSelect?: (ticker: string) => void }) {
  if (tabId === "risk-watchlist") {
    return <RiskWatchlistTab onTickerSelect={onTickerSelect} />;
  }
  if (PM_TABS_UNDER_TRAINING.has(tabId)) {
    const title = pmTabs.find((t) => t.id === tabId)?.label ?? "PM Dashboard";
    return <OreoTrainingPlaceholder title={title} />;
  }
  return (
    <Card>
      <p className="text-sm" style={{ color: "var(--muted2)" }}>Tab: {tabId}</p>
    </Card>
  );
}
