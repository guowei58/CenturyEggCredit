import { prisma } from "@/lib/prisma";
import {
  isCikWorkspaceKey,
  isPrivateWorkspaceKey,
  privateWorkspaceDisplayName,
} from "@/lib/company-workspace-key";
import { readPrivateWorkspaceMeta } from "@/lib/private-workspace-meta";
import { getCompanyProfile } from "@/lib/sec-edgar";
import { Prisma, type RiskAnswerLabel, type RiskAssessmentStatus } from "@/generated/prisma/client";
import {
  calculateIssuerRiskScore,
  calculateSecurityRiskScore,
} from "./scoring";
import {
  calculateOverallCreditRiskScore,
  calculateQuestionPoints,
  defaultReviewDaysForClassification,
  roundDisplayScore,
} from "./classification";
import { calculateRiskVelocity, calculateOptionalVelocityWindows } from "./velocity";
import { CATEGORY_LABELS, CATEGORY_MAX_POINTS, DAGGER_FLAG_QUESTIONS, ISSUER_RISK_BUCKET_KEYS, issuerRiskQuestionShortLabel } from "./seed-data";
import { getActiveIssuerTemplate, getActiveSecurityTemplate, ensureRiskChecklistTemplatesSeeded } from "./seed";
import type { RiskAnswerLabel as UiAnswerLabel } from "./types";

export type AnswerInput = {
  questionId: string;
  answerLabel?: UiAnswerLabel | null;
  metricValue?: number | null;
  metricUnit?: string | null;
  metricPeriod?: string | null;
  analystComment?: string | null;
  sourceUrl?: string | null;
  sourceDescription?: string | null;
  sourceAsOfDate?: string | null;
  internalDocumentId?: string | null;
  confidence?: string | null;
};

export type DaggerInput = {
  daggerCode: string;
  isActive: boolean;
  severity?: string | null;
  analystComment?: string | null;
  sourceUrl?: string | null;
  internalDocumentId?: string | null;
  identifiedDate?: string | null;
  lastReviewedDate?: string | null;
  resolvedDate?: string | null;
  resolutionComment?: string | null;
};

function decimal(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

function toNum(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t) : null;
}

async function logAudit(params: {
  userId: string;
  ticker: string;
  assessmentId?: string | null;
  securityInstrumentId?: string | null;
  action: string;
  previousValue?: string | null;
  newValue?: string | null;
  explanation?: string | null;
  performedBy: string;
}) {
  await prisma.riskAuditLog.create({
    data: {
      userId: params.userId,
      ticker: params.ticker,
      assessmentId: params.assessmentId ?? null,
      securityInstrumentId: params.securityInstrumentId ?? null,
      action: params.action,
      previousValue: params.previousValue ?? null,
      newValue: params.newValue ?? null,
      explanation: params.explanation ?? null,
      performedBy: params.performedBy,
    },
  });
}

export async function getOrCreateScoringConfig(userId: string) {
  return prisma.riskScoringConfig.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

async function dedupeDaggerFlags(userId: string, ticker: string) {
  const all = await prisma.riskDaggerFlag.findMany({
    where: { userId, ticker },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  const seen = new Set<string>();
  const deleteIds: string[] = [];
  for (const row of all) {
    if (seen.has(row.daggerCode)) {
      deleteIds.push(row.id);
    } else {
      seen.add(row.daggerCode);
    }
  }
  if (deleteIds.length > 0) {
    await prisma.riskDaggerFlag.deleteMany({ where: { id: { in: deleteIds } } });
  }
}

async function ensureDaggerStubs(userId: string, ticker: string) {
  await dedupeDaggerFlags(userId, ticker);
  await prisma.riskDaggerFlag.createMany({
    data: DAGGER_FLAG_QUESTIONS.map((d) => ({
      userId,
      ticker,
      daggerCode: d.questionCode,
      isActive: false,
    })),
    skipDuplicates: true,
  });
}

async function getActiveDaggers(userId: string, ticker: string) {
  await ensureDaggerStubs(userId, ticker);
  return prisma.riskDaggerFlag.findMany({
    where: { userId, ticker },
    orderBy: { daggerCode: "asc" },
  });
}

async function findIssuerDraft(userId: string, ticker: string) {
  const template = await getActiveIssuerTemplate();
  if (!template) throw new Error("Issuer template not found");

  return prisma.riskAssessment.findFirst({
    where: {
      userId,
      ticker,
      assessmentType: "issuer",
      status: { in: ["draft", "reopened"] },
    },
    include: {
      answers: { include: { question: true } },
      template: { include: { questions: { where: { isActive: true }, orderBy: { displayOrder: "asc" } } } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

async function ensureIssuerDraft(userId: string, ticker: string, performedBy: string) {
  const existing = await findIssuerDraft(userId, ticker);
  if (existing) return existing;

  const template = await getActiveIssuerTemplate();
  if (!template) throw new Error("Issuer template not found");

  const draft = await prisma.riskAssessment.create({
    data: {
      userId,
      ticker,
      templateId: template.id,
      assessmentType: "issuer",
      status: "draft",
      createdBy: performedBy,
    },
    include: {
      answers: { include: { question: true } },
      template: { include: { questions: { where: { isActive: true }, orderBy: { displayOrder: "asc" } } } },
    },
  });

  await logAudit({
    userId,
    ticker,
    assessmentId: draft.id,
    action: "assessment_created",
    performedBy,
  });

  return draft;
}

export async function findIssuerDraftForAnalyze(userId: string, ticker: string) {
  await ensureRiskChecklistTemplatesSeeded();
  let draft = await findIssuerDraft(userId, ticker);
  if (!draft) {
    draft = await ensureIssuerDraft(userId, ticker, userId);
  }
  const questions = draft.template.questions.map((q) => ({
    id: q.id,
    questionCode: q.questionCode,
    categoryLabel: CATEGORY_LABELS[q.category] ?? q.category,
    questionText: q.questionText,
  }));
  return {
    isEditable: draft.status === "draft" || draft.status === "reopened",
    questions,
  };
}

async function getLatestCompletedIssuer(userId: string, ticker: string) {
  return prisma.riskAssessment.findFirst({
    where: { userId, ticker, assessmentType: "issuer", status: "completed" },
    orderBy: { completedAt: "desc" },
    include: {
      answers: { include: { question: true } },
      template: { include: { questions: { where: { isActive: true }, orderBy: { displayOrder: "asc" } } } },
    },
  });
}

function buildScoringInputs(
  questions: Array<{ id: string; questionCode: string; category: string; maxPoints: Prisma.Decimal }>,
  answers: Array<{ questionId: string; answerLabel: RiskAnswerLabel }>
) {
  const answerMap = new Map(answers.map((a) => [a.questionId, a.answerLabel]));
  return questions.map((q) => ({
    questionId: q.id,
    questionCode: q.questionCode,
    category: q.category,
    maxPoints: Number(q.maxPoints),
    answerLabel: (answerMap.get(q.id) ?? "unknown") as UiAnswerLabel,
  }));
}

function serializeAssessmentScores(
  score: ReturnType<typeof calculateIssuerRiskScore>,
  manualOverrideScore: number | null,
  manualOverrideClassification: string | null
) {
  return {
    rawScore: score.rawScore,
    effectiveScore: score.effectiveScore,
    finalScore: manualOverrideScore ?? score.finalScore,
    classification: score.classification,
    effectiveClassification: manualOverrideClassification ?? score.effectiveClassification,
    daggerOverrideReason: score.daggerOverrideReason,
    dataConfidence: score.dataConfidence,
    categoryScores: score.categoryScores.map((c) => ({
      ...c,
      label: CATEGORY_LABELS[c.category] ?? c.category,
      displayScoreRounded: roundDisplayScore(c.displayScore),
    })),
  };
}

function serializeIssuerAssessmentWorkspace(
  activeAssessment: {
    id: string;
    status: RiskAssessmentStatus;
    templateId: string;
    updatedAt: Date;
    createdBy: string | null;
    nextReviewDate: Date | null;
    manualOverrideScore: Prisma.Decimal | null;
    manualOverrideClassification: string | null;
    manualOverrideReason: string | null;
    manualOverrideReviewDate: Date | null;
    template: {
      version: number;
      questions: Array<{
        id: string;
        questionCode: string;
        category: string;
        questionText: string;
        maxPoints: Prisma.Decimal;
      }>;
    };
    answers: Array<{
      questionId: string;
      answerLabel: RiskAnswerLabel;
      answerValue: Prisma.Decimal;
      metricValue: Prisma.Decimal | null;
      metricUnit: string | null;
      metricPeriod: string | null;
      analystComment: string | null;
      sourceUrl: string | null;
      sourceDescription: string | null;
      sourceAsOfDate: Date | null;
      internalDocumentId: string | null;
      confidence: string | null;
      updatedBy: string | null;
      updatedAt: Date;
    }>;
  },
  isEditable: boolean
) {
  const questions = activeAssessment.template.questions;
  const scoringInputs = buildScoringInputs(questions, activeAssessment.answers);
  const score = calculateIssuerRiskScore({
    questions: scoringInputs,
    activeDaggers: [],
    manualOverrideScore: toNum(activeAssessment.manualOverrideScore),
    manualOverrideClassification: activeAssessment.manualOverrideClassification,
  });
  const answerByQuestion = new Map(activeAssessment.answers.map((a) => [a.questionId, a]));

  return {
    assessment: {
      id: activeAssessment.id,
      status: activeAssessment.status,
      templateId: activeAssessment.templateId,
      templateVersion: activeAssessment.template.version,
      updatedAt: activeAssessment.updatedAt.toISOString(),
      updatedBy: activeAssessment.answers[0]?.updatedBy ?? activeAssessment.createdBy,
      nextReviewDate: activeAssessment.nextReviewDate?.toISOString() ?? null,
      manualOverrideScore: toNum(activeAssessment.manualOverrideScore),
      manualOverrideClassification: activeAssessment.manualOverrideClassification,
      manualOverrideReason: activeAssessment.manualOverrideReason,
      manualOverrideReviewDate: activeAssessment.manualOverrideReviewDate?.toISOString() ?? null,
      isEditable,
    },
    scores: {
      ...serializeAssessmentScores(
        score,
        toNum(activeAssessment.manualOverrideScore),
        activeAssessment.manualOverrideClassification
      ),
      rawScoreRounded: roundDisplayScore(score.rawScore),
      effectiveScoreRounded: roundDisplayScore(score.effectiveScore),
      finalScoreRounded: roundDisplayScore(
        toNum(activeAssessment.manualOverrideScore) ?? score.finalScore
      ),
    },
    categories: Object.entries(CATEGORY_LABELS)
      .filter(([k]) => k !== "dagger" && k !== "security_documentation")
      .map(([key, label]) => {
        const cat = score.categoryScores.find((c) => c.category === key);
        return {
          key,
          label,
          maxPoints: CATEGORY_MAX_POINTS[key] ?? 0,
          earnedPoints: cat?.earnedPoints ?? 0,
          applicableMaxPoints: cat?.applicableMaxPoints ?? 0,
          displayScore: cat?.displayScore ?? 0,
          displayScoreRounded: roundDisplayScore(cat?.displayScore ?? 0),
          unansweredCount: cat?.unansweredCount ?? 0,
        };
      }),
    questions: questions.map((q) => {
      const a = answerByQuestion.get(q.id);
      const label = (a?.answerLabel ?? "unknown") as UiAnswerLabel;
      const max = Number(q.maxPoints);
      return {
        id: q.id,
        questionCode: q.questionCode,
        category: q.category,
        categoryLabel: CATEGORY_LABELS[q.category] ?? q.category,
        questionText: q.questionText,
        maxPoints: max,
        answerLabel: label,
        answerValue: toNum(a?.answerValue) ?? 0.5,
        calculatedPoints: calculateQuestionPoints(max, label),
        metricValue: toNum(a?.metricValue),
        metricUnit: a?.metricUnit ?? null,
        metricPeriod: a?.metricPeriod ?? null,
        analystComment: a?.analystComment ?? null,
        sourceUrl: a?.sourceUrl ?? null,
        sourceDescription: a?.sourceDescription ?? null,
        sourceAsOfDate: a?.sourceAsOfDate?.toISOString() ?? null,
        internalDocumentId: a?.internalDocumentId ?? null,
        confidence: a?.confidence ?? null,
        updatedBy: a?.updatedBy ?? null,
        updatedAt: a?.updatedAt?.toISOString() ?? null,
        isIncomplete: !a || label === "unknown",
      };
    }),
  };
}

export async function loadRiskChecklistWorkspace(userId: string, ticker: string) {
  await ensureRiskChecklistTemplatesSeeded();
  let draft = await findIssuerDraft(userId, ticker);
  const latestCompleted = await getLatestCompletedIssuer(userId, ticker);
  if (!draft && !latestCompleted) {
    draft = await ensureIssuerDraft(userId, ticker, userId);
  }
  const activeAssessment = draft ?? latestCompleted;
  if (!activeAssessment) throw new Error("Unable to load assessment");

  const [securities, summary, config, completedHistory] = await Promise.all([
    prisma.riskSecurityInstrument.findMany({ where: { userId, ticker }, orderBy: { name: "asc" } }),
    prisma.riskIssuerSummary.findUnique({ where: { userId_ticker: { userId, ticker } } }),
    getOrCreateScoringConfig(userId),
    prisma.riskAssessment.findMany({
      where: { userId, ticker, assessmentType: "issuer", status: "completed" },
      orderBy: { completedAt: "desc" },
      take: 50,
      select: {
        id: true,
        rawScore: true,
        effectiveScore: true,
        finalScore: true,
        classification: true,
        dataConfidence: true,
        completedAt: true,
        completedBy: true,
        assessmentDate: true,
      },
    }),
  ]);

  const questions = activeAssessment.template.questions;
  const scoringInputs = buildScoringInputs(questions, activeAssessment.answers);
  const score = calculateIssuerRiskScore({
    questions: scoringInputs,
    activeDaggers: [],
    manualOverrideScore: toNum(activeAssessment.manualOverrideScore),
    manualOverrideClassification: activeAssessment.manualOverrideClassification,
  });

  const velocityHistory = completedHistory
    .filter((h) => h.completedAt && h.effectiveScore != null)
    .map((h) => ({
      effectiveScore: Number(h.effectiveScore),
      completedAt: h.completedAt!,
    }));
  const velocity = calculateRiskVelocity(score.effectiveScore, velocityHistory);
  const optionalVelocity = calculateOptionalVelocityWindows(score.effectiveScore, velocityHistory);

  const answerByQuestion = new Map(activeAssessment.answers.map((a) => [a.questionId, a]));

  return {
    assessment: {
      id: activeAssessment.id,
      status: activeAssessment.status,
      templateId: activeAssessment.templateId,
      templateVersion: activeAssessment.template.version,
      updatedAt: activeAssessment.updatedAt.toISOString(),
      updatedBy: activeAssessment.answers[0]?.updatedBy ?? activeAssessment.createdBy,
      nextReviewDate: activeAssessment.nextReviewDate?.toISOString() ?? null,
      manualOverrideScore: toNum(activeAssessment.manualOverrideScore),
      manualOverrideClassification: activeAssessment.manualOverrideClassification,
      manualOverrideReason: activeAssessment.manualOverrideReason,
      manualOverrideReviewDate: activeAssessment.manualOverrideReviewDate?.toISOString() ?? null,
      isEditable: Boolean(draft),
    },
    scores: {
      ...serializeAssessmentScores(
        score,
        toNum(activeAssessment.manualOverrideScore),
        activeAssessment.manualOverrideClassification
      ),
      rawScoreRounded: roundDisplayScore(score.rawScore),
      effectiveScoreRounded: roundDisplayScore(score.effectiveScore),
      finalScoreRounded: roundDisplayScore(
        toNum(activeAssessment.manualOverrideScore) ?? score.finalScore
      ),
      riskVelocity: velocity.delta,
      riskVelocityStatus: velocity.status,
      riskVelocity30: optionalVelocity.days30,
      riskVelocity180: optionalVelocity.days180,
    },
    categories: Object.entries(CATEGORY_LABELS)
      .filter(([k]) => k !== "dagger" && k !== "security_documentation")
      .map(([key, label]) => {
        const cat = score.categoryScores.find((c) => c.category === key);
        return {
          key,
          label,
          maxPoints: CATEGORY_MAX_POINTS[key] ?? 0,
          earnedPoints: cat?.earnedPoints ?? 0,
          applicableMaxPoints: cat?.applicableMaxPoints ?? 0,
          displayScore: cat?.displayScore ?? 0,
          displayScoreRounded: roundDisplayScore(cat?.displayScore ?? 0),
          unansweredCount: cat?.unansweredCount ?? 0,
        };
      }),
    questions: questions.map((q) => {
      const a = answerByQuestion.get(q.id);
      const label = (a?.answerLabel ?? "unknown") as UiAnswerLabel;
      const max = Number(q.maxPoints);
      return {
        id: q.id,
        questionCode: q.questionCode,
        category: q.category,
        categoryLabel: CATEGORY_LABELS[q.category] ?? q.category,
        questionText: q.questionText,
        maxPoints: max,
        answerLabel: label,
        answerValue: toNum(a?.answerValue) ?? 0.5,
        calculatedPoints: calculateQuestionPoints(max, label),
        metricValue: toNum(a?.metricValue),
        metricUnit: a?.metricUnit ?? null,
        metricPeriod: a?.metricPeriod ?? null,
        analystComment: a?.analystComment ?? null,
        sourceUrl: a?.sourceUrl ?? null,
        sourceDescription: a?.sourceDescription ?? null,
        sourceAsOfDate: a?.sourceAsOfDate?.toISOString() ?? null,
        internalDocumentId: a?.internalDocumentId ?? null,
        confidence: a?.confidence ?? null,
        updatedBy: a?.updatedBy ?? null,
        updatedAt: a?.updatedAt?.toISOString() ?? null,
        isIncomplete: !a || label === "unknown",
      };
    }),
    securities: securities.map((s) => ({
      id: s.id,
      name: s.name,
      cusip: s.cusip,
      isin: s.isin,
      priority: s.priority,
      lienLevel: s.lienLevel,
      maturityDate: s.maturityDate?.toISOString() ?? null,
    })),
    summary: summary
      ? {
          rawScore: toNum(summary.rawScore),
          effectiveScore: toNum(summary.effectiveScore),
          finalScore: toNum(summary.finalScore),
          classification: summary.classification,
          riskVelocity: toNum(summary.riskVelocity),
          riskVelocityStatus: summary.riskVelocityStatus,
          activeDaggerCount: summary.activeDaggerCount,
          dataConfidence: toNum(summary.dataConfidence),
          lastUpdatedAt: summary.lastUpdatedAt?.toISOString() ?? null,
          nextReviewDate: summary.nextReviewDate?.toISOString() ?? null,
          assessmentOverdue: summary.assessmentOverdue,
        }
      : null,
    scoringConfig: {
      issuerWeightPercent: config.issuerWeightPercent,
      securityWeightPercent: config.securityWeightPercent,
    },
    history: completedHistory.map((h, i) => {
      const prev = completedHistory[i + 1];
      const eff = toNum(h.effectiveScore);
      const prevEff = prev ? toNum(prev.effectiveScore) : null;
      return {
        id: h.id,
        rawScore: toNum(h.rawScore),
        effectiveScore: eff,
        finalScore: toNum(h.finalScore),
        classification: h.classification,
        dataConfidence: toNum(h.dataConfidence),
        completedAt: h.completedAt?.toISOString() ?? null,
        completedBy: h.completedBy,
        scoreChangeFromPrior: eff != null && prevEff != null ? eff - prevEff : null,
      };
    }),
  };
}

export async function saveRiskAnswers(
  userId: string,
  ticker: string,
  answers: AnswerInput[],
  performedBy: string
) {
  const draft = await ensureIssuerDraft(userId, ticker, performedBy);
  if (draft.status === "completed") {
    throw new Error("Cannot modify a completed assessment");
  }

  const questionMap = new Map(draft.template.questions.map((q) => [q.id, q]));
  let savedCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const input of answers) {
      const q = questionMap.get(input.questionId);
      if (!q) continue;
      savedCount += 1;
      const label = (input.answerLabel ?? "unknown") as RiskAnswerLabel;
      const max = Number(q.maxPoints);
      const points = calculateQuestionPoints(max, label as UiAnswerLabel);
      const prev = draft.answers.find((a) => a.questionId === input.questionId);

      await tx.riskAssessmentAnswer.upsert({
        where: {
          assessmentId_questionId: { assessmentId: draft.id, questionId: input.questionId },
        },
        create: {
          assessmentId: draft.id,
          questionId: input.questionId,
          answerLabel: label,
          answerValue: decimal(label === "not_applicable" ? 0 : label === "no" ? 0 : label === "yes" ? 1 : 0.5),
          calculatedPoints: decimal(points),
          metricValue: input.metricValue != null ? decimal(input.metricValue) : null,
          metricUnit: input.metricUnit ?? null,
          metricPeriod: input.metricPeriod ?? null,
          analystComment: input.analystComment ?? null,
          sourceUrl: input.sourceUrl ?? null,
          sourceDescription: input.sourceDescription ?? null,
          sourceAsOfDate: parseDate(input.sourceAsOfDate),
          internalDocumentId: input.internalDocumentId ?? null,
          confidence: input.confidence ?? null,
          createdBy: performedBy,
          updatedBy: performedBy,
        },
        update: {
          answerLabel: label,
          answerValue: decimal(label === "not_applicable" ? 0 : label === "no" ? 0 : label === "yes" ? 1 : 0.5),
          calculatedPoints: decimal(points),
          metricValue: input.metricValue != null ? decimal(input.metricValue) : null,
          metricUnit: input.metricUnit ?? null,
          metricPeriod: input.metricPeriod ?? null,
          analystComment: input.analystComment ?? null,
          sourceUrl: input.sourceUrl ?? null,
          sourceDescription: input.sourceDescription ?? null,
          sourceAsOfDate: parseDate(input.sourceAsOfDate),
          internalDocumentId: input.internalDocumentId ?? null,
          confidence: input.confidence ?? null,
          updatedBy: performedBy,
        },
      });

      if (prev && prev.answerLabel !== label) {
        await tx.riskAuditLog.create({
          data: {
            userId,
            ticker,
            assessmentId: draft.id,
            action: "answer_changed",
            previousValue: prev.answerLabel,
            newValue: label,
            performedBy,
          },
        });
      }
    }

    await tx.riskAssessment.update({
      where: { id: draft.id },
      data: { updatedAt: new Date() },
    });
  });

  if (savedCount === 0 && answers.length > 0) {
    throw new Error("Answers could not be saved. Refresh the page and try again.");
  }

  const updated = await prisma.riskAssessment.findUniqueOrThrow({
    where: { id: draft.id },
    include: {
      answers: true,
      template: {
        include: { questions: { where: { isActive: true }, orderBy: { displayOrder: "asc" } } },
      },
    },
  });

  void refreshIssuerSummary(userId, ticker).catch((e) => {
    console.error("[risk-checklist] refreshIssuerSummary failed:", e);
  });

  return serializeIssuerAssessmentWorkspace(updated, true);
}

export async function saveDaggerFlags(
  userId: string,
  ticker: string,
  flags: DaggerInput[],
  performedBy: string
) {
  await ensureDaggerStubs(userId, ticker);

  await prisma.$transaction(async (tx) => {
    for (const f of flags) {
      const prev = await tx.riskDaggerFlag.findFirst({
        where: { userId, ticker, daggerCode: f.daggerCode },
      });
      const wasActive = prev?.isActive ?? false;
      const data = {
        isActive: f.isActive,
        severity: f.severity ?? null,
        analystComment: f.analystComment ?? null,
        sourceUrl: f.sourceUrl ?? null,
        internalDocumentId: f.internalDocumentId ?? null,
        identifiedDate: parseDate(f.identifiedDate) ?? prev?.identifiedDate ?? (f.isActive ? new Date() : null),
        lastReviewedDate: parseDate(f.lastReviewedDate) ?? new Date(),
        resolvedDate: f.isActive ? null : parseDate(f.resolvedDate) ?? new Date(),
        resolvedBy: f.isActive ? null : performedBy,
        resolutionComment: f.resolutionComment ?? null,
      };

      if (prev) {
        await tx.riskDaggerFlag.update({ where: { id: prev.id }, data });
      } else {
        await tx.riskDaggerFlag.create({
          data: {
            userId,
            ticker,
            daggerCode: f.daggerCode,
            ...data,
          },
        });
      }

      if (wasActive !== f.isActive) {
        await tx.riskAuditLog.create({
          data: {
            userId,
            ticker,
            action: f.isActive ? "dagger_activated" : "dagger_resolved",
            previousValue: String(wasActive),
            newValue: String(f.isActive),
            explanation: f.daggerCode,
            performedBy,
          },
        });
      }
    }
  });

  await refreshIssuerSummary(userId, ticker);
  return loadRiskChecklistWorkspace(userId, ticker);
}

export async function completeIssuerAssessment(userId: string, ticker: string, performedBy: string) {
  const draft = await findIssuerDraft(userId, ticker);
  if (!draft) throw new Error("No draft assessment to complete");
  const scoringInputs = buildScoringInputs(draft.template.questions, draft.answers);
  const score = calculateIssuerRiskScore({
    questions: scoringInputs,
    activeDaggers: [],
    manualOverrideScore: toNum(draft.manualOverrideScore),
    manualOverrideClassification: draft.manualOverrideClassification,
  });

  const now = new Date();
  const reviewDays = defaultReviewDaysForClassification(score.effectiveClassification);
  const nextReview = new Date(now.getTime() + reviewDays * 24 * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.riskAssessment.update({
      where: { id: draft.id },
      data: {
        status: "completed" satisfies RiskAssessmentStatus,
        rawScore: decimal(score.rawScore),
        effectiveScore: decimal(score.effectiveScore),
        finalScore: decimal(score.finalScore),
        classification: score.effectiveClassification,
        daggerOverrideReason: score.daggerOverrideReason,
        dataConfidence: decimal(score.dataConfidence),
        assessmentDate: now,
        completedAt: now,
        completedBy: performedBy,
        nextReviewDate: nextReview,
      },
    });

    await tx.riskAuditLog.create({
      data: {
        userId,
        ticker,
        assessmentId: draft.id,
        action: "assessment_completed",
        newValue: JSON.stringify({
          rawScore: score.rawScore,
          effectiveScore: score.effectiveScore,
          classification: score.effectiveClassification,
        }),
        performedBy,
      },
    });
  });

  await refreshIssuerSummary(userId, ticker);
  return loadRiskChecklistWorkspace(userId, ticker);
}

export async function reopenIssuerAssessment(userId: string, ticker: string, performedBy: string) {
  const latest = await prisma.riskAssessment.findFirst({
    where: { userId, ticker, assessmentType: "issuer", status: "completed" },
    orderBy: { completedAt: "desc" },
    include: { answers: true, template: true },
  });
  if (!latest) throw new Error("No completed assessment to reopen");

  const existingDraft = await prisma.riskAssessment.findFirst({
    where: { userId, ticker, assessmentType: "issuer", status: { in: ["draft", "reopened"] } },
  });
  if (existingDraft) {
    throw new Error("A draft assessment already exists");
  }

  const template = await getActiveIssuerTemplate();
  if (!template) throw new Error("Issuer template not found");

  const newDraft = await prisma.$transaction(async (tx) => {
    const created = await tx.riskAssessment.create({
      data: {
        userId,
        ticker,
        templateId: template.id,
        assessmentType: "issuer",
        status: "reopened",
        createdBy: performedBy,
      },
    });

    for (const a of latest.answers) {
      await tx.riskAssessmentAnswer.create({
        data: {
          assessmentId: created.id,
          questionId: a.questionId,
          answerLabel: a.answerLabel,
          answerValue: a.answerValue,
          calculatedPoints: a.calculatedPoints,
          metricValue: a.metricValue,
          metricUnit: a.metricUnit,
          metricPeriod: a.metricPeriod,
          analystComment: a.analystComment,
          sourceUrl: a.sourceUrl,
          sourceDescription: a.sourceDescription,
          sourceAsOfDate: a.sourceAsOfDate,
          internalDocumentId: a.internalDocumentId,
          confidence: a.confidence,
          createdBy: performedBy,
          updatedBy: performedBy,
        },
      });
    }

    await tx.riskAuditLog.create({
      data: {
        userId,
        ticker,
        assessmentId: created.id,
        action: "assessment_reopened",
        previousValue: latest.id,
        performedBy,
      },
    });

    return created;
  });

  void newDraft;
  return loadRiskChecklistWorkspace(userId, ticker);
}

export async function duplicatePriorAssessment(
  userId: string,
  ticker: string,
  sourceAssessmentId: string,
  performedBy: string
) {
  const source = await prisma.riskAssessment.findFirst({
    where: { id: sourceAssessmentId, userId, ticker, assessmentType: "issuer" },
    include: { answers: true },
  });
  if (!source) throw new Error("Source assessment not found");

  const existingDraft = await prisma.riskAssessment.findFirst({
    where: { userId, ticker, assessmentType: "issuer", status: { in: ["draft", "reopened"] } },
  });
  if (existingDraft) {
    await prisma.riskAssessment.delete({ where: { id: existingDraft.id } });
  }

  const template = await getActiveIssuerTemplate();
  if (!template) throw new Error("Issuer template not found");

  await prisma.$transaction(async (tx) => {
    const created = await tx.riskAssessment.create({
      data: {
        userId,
        ticker,
        templateId: template.id,
        assessmentType: "issuer",
        status: "draft",
        createdBy: performedBy,
      },
    });

    for (const a of source.answers) {
      await tx.riskAssessmentAnswer.create({
        data: {
          assessmentId: created.id,
          questionId: a.questionId,
          answerLabel: a.answerLabel,
          answerValue: a.answerValue,
          calculatedPoints: a.calculatedPoints,
          metricValue: a.metricValue,
          metricUnit: a.metricUnit,
          metricPeriod: a.metricPeriod,
          analystComment: a.analystComment,
          sourceUrl: a.sourceUrl,
          sourceDescription: a.sourceDescription,
          sourceAsOfDate: a.sourceAsOfDate,
          internalDocumentId: a.internalDocumentId,
          confidence: a.confidence,
          createdBy: performedBy,
          updatedBy: performedBy,
        },
      });
    }

    await tx.riskAuditLog.create({
      data: {
        userId,
        ticker,
        assessmentId: created.id,
        action: "assessment_duplicated",
        previousValue: sourceAssessmentId,
        performedBy,
      },
    });
  });

  return loadRiskChecklistWorkspace(userId, ticker);
}

export async function applyManualOverride(
  userId: string,
  ticker: string,
  params: {
    overrideScore: number;
    overrideClassification?: string | null;
    reason: string;
    reviewDate: string;
  },
  performedBy: string
) {
  const draft = await ensureIssuerDraft(userId, ticker, performedBy);
  await prisma.$transaction(async (tx) => {
    await tx.riskAssessment.update({
      where: { id: draft.id },
      data: {
        manualOverrideScore: decimal(params.overrideScore),
        manualOverrideClassification: params.overrideClassification ?? null,
        manualOverrideReason: params.reason,
        manualOverrideReviewDate: parseDate(params.reviewDate),
        manualOverrideBy: performedBy,
      },
    });
    await tx.riskAuditLog.create({
      data: {
        userId,
        ticker,
        assessmentId: draft.id,
        action: "score_manually_overridden",
        newValue: String(params.overrideScore),
        explanation: params.reason,
        performedBy,
      },
    });
  });
  await refreshIssuerSummary(userId, ticker);
  return loadRiskChecklistWorkspace(userId, ticker);
}

export async function refreshIssuerSummary(userId: string, ticker: string) {
  const latestCompleted = await prisma.riskAssessment.findFirst({
    where: { userId, ticker, assessmentType: "issuer", status: "completed" },
    orderBy: { completedAt: "desc" },
  });

  const draft = await prisma.riskAssessment.findFirst({
    where: { userId, ticker, assessmentType: "issuer", status: { in: ["draft", "reopened"] } },
    include: {
      answers: true,
      template: { include: { questions: { where: { isActive: true } } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const scoringSource =
    draft ??
    (latestCompleted
      ? await prisma.riskAssessment.findFirst({
          where: { id: latestCompleted.id },
          include: {
            answers: true,
            template: { include: { questions: { where: { isActive: true } } } },
          },
        })
      : null);

  const activeCount = 0;

  let rawScore: number | null = null;
  let effectiveScore: number | null = null;
  let finalScore: number | null = null;
  let classification: string | null = null;
  let dataConfidence: number | null = null;
  let lastAssessmentId: string | null = null;
  let lastUpdatedAt: Date | null = null;
  let nextReviewDate: Date | null = null;

  if (scoringSource) {
    const questions = scoringSource.template.questions;
    const answers = scoringSource.answers as Array<{ questionId: string; answerLabel: RiskAnswerLabel }>;
    const scoringInputs = buildScoringInputs(questions, answers);
    const score = calculateIssuerRiskScore({
      questions: scoringInputs,
      activeDaggers: [],
      manualOverrideScore: toNum(scoringSource.manualOverrideScore),
      manualOverrideClassification: scoringSource.manualOverrideClassification ?? null,
    });
    rawScore = score.rawScore;
    effectiveScore = score.effectiveScore;
    finalScore = score.finalScore;
    classification = score.effectiveClassification;
    dataConfidence = score.dataConfidence;
    lastAssessmentId = latestCompleted?.id ?? draft?.id ?? null;
    lastUpdatedAt = latestCompleted?.completedAt ?? draft?.updatedAt ?? scoringSource.updatedAt ?? null;
    nextReviewDate = latestCompleted?.nextReviewDate ?? draft?.nextReviewDate ?? null;
  }

  const history = await prisma.riskAssessment.findMany({
    where: { userId, ticker, assessmentType: "issuer", status: "completed" },
    orderBy: { completedAt: "desc" },
    take: 50,
    select: { effectiveScore: true, completedAt: true },
  });
  const velocity = calculateRiskVelocity(
    effectiveScore ?? 0,
    history
      .filter((h) => h.completedAt && h.effectiveScore != null)
      .map((h) => ({ effectiveScore: Number(h.effectiveScore), completedAt: h.completedAt! }))
  );

  const now = new Date();
  const assessmentOverdue = nextReviewDate ? nextReviewDate.getTime() < now.getTime() : false;

  await prisma.riskIssuerSummary.upsert({
    where: { userId_ticker: { userId, ticker } },
    create: {
      userId,
      ticker,
      rawScore: rawScore != null ? decimal(rawScore) : null,
      effectiveScore: effectiveScore != null ? decimal(effectiveScore) : null,
      finalScore: finalScore != null ? decimal(finalScore) : null,
      classification,
      riskVelocity: velocity.delta != null ? decimal(velocity.delta) : null,
      riskVelocityStatus: velocity.status,
      activeDaggerCount: activeCount,
      dataConfidence: dataConfidence != null ? decimal(dataConfidence) : null,
      lastAssessmentId,
      lastUpdatedAt,
      nextReviewDate,
      assessmentOverdue,
    },
    update: {
      rawScore: rawScore != null ? decimal(rawScore) : null,
      effectiveScore: effectiveScore != null ? decimal(effectiveScore) : null,
      finalScore: finalScore != null ? decimal(finalScore) : null,
      classification,
      riskVelocity: velocity.delta != null ? decimal(velocity.delta) : null,
      riskVelocityStatus: velocity.status,
      activeDaggerCount: activeCount,
      dataConfidence: dataConfidence != null ? decimal(dataConfidence) : null,
      lastAssessmentId,
      lastUpdatedAt,
      nextReviewDate,
      assessmentOverdue,
    },
  });
}

export type WatchlistQuery = {
  sort?: string;
  classification?: string;
  minScore?: number;
  maxScore?: number;
  daggerOnly?: boolean;
  rapidlyDeteriorating?: boolean;
  lowConfidence?: boolean;
  assessmentOverdue?: boolean;
  noAssessment?: boolean;
  maturityWithinMonths?: number;
};

const issuerAssessmentInclude = {
  answers: { select: { questionId: true, answerLabel: true } },
  template: {
    include: {
      questions: { where: { isActive: true }, orderBy: { displayOrder: "asc" as const } },
    },
  },
};

export type RiskPortfolioRow = {
  ticker: string;
  companyName: string;
  compositeScore: number;
  classification: string;
  buckets: Record<(typeof ISSUER_RISK_BUCKET_KEYS)[number], number>;
  lastUpdated: string;
  status: string;
};

async function resolveWorkspaceDisplayNames(userId: string, tickers: string[]): Promise<Map<string, string>> {
  if (tickers.length === 0) return new Map();

  const profiles = await prisma.publicRecordsProfile.findMany({
    where: { userId, ticker: { in: tickers } },
    select: { ticker: true, companyName: true },
  });
  const profileNameByTicker = new Map(
    profiles.map((p) => [p.ticker, p.companyName?.trim() || null] as const)
  );

  const privateTickers = tickers.filter(isPrivateWorkspaceKey);
  const privateMetaEntries = await Promise.all(
    privateTickers.map(async (ticker) => {
      const meta = await readPrivateWorkspaceMeta(userId, ticker);
      return [ticker, meta?.displayName?.trim() || null] as const;
    })
  );
  const privateMetaByTicker = new Map(privateMetaEntries);

  const publicTickers = tickers.filter((ticker) => !isPrivateWorkspaceKey(ticker));
  const secNameEntries = await Promise.all(
    publicTickers.map(async (ticker) => {
      const stored = profileNameByTicker.get(ticker);
      if (stored) return [ticker, stored] as const;
      try {
        const profile = await getCompanyProfile(ticker);
        return [ticker, profile?.name?.trim() || null] as const;
      } catch {
        return [ticker, null] as const;
      }
    })
  );
  const secNameByTicker = new Map(secNameEntries);

  const names = new Map<string, string>();
  for (const ticker of tickers) {
    if (isPrivateWorkspaceKey(ticker)) {
      names.set(
        ticker,
        privateWorkspaceDisplayName(ticker, profileNameByTicker.get(ticker) ?? privateMetaByTicker.get(ticker))
      );
      continue;
    }

    const stored = profileNameByTicker.get(ticker) ?? secNameByTicker.get(ticker);
    if (stored && stored.toUpperCase() !== ticker) {
      names.set(ticker, stored);
      continue;
    }

    names.set(ticker, isCikWorkspaceKey(ticker) ? "SEC filer" : ticker);
  }

  return names;
}

export async function getRiskPortfolioRows(userId: string): Promise<RiskPortfolioRow[]> {
  const tickerRows = await prisma.riskAssessment.findMany({
    where: { userId, assessmentType: "issuer" },
    select: { ticker: true },
    distinct: ["ticker"],
  });
  if (tickerRows.length === 0) return [];

  const tickerList = tickerRows.map((t) => t.ticker);
  const companyNameByTicker = await resolveWorkspaceDisplayNames(userId, tickerList);
  const [drafts, completedAssessments] = await Promise.all([
    prisma.riskAssessment.findMany({
      where: {
        userId,
        ticker: { in: tickerList },
        assessmentType: "issuer",
        status: { in: ["draft", "reopened"] },
      },
      include: issuerAssessmentInclude,
    }),
    prisma.riskAssessment.findMany({
      where: {
        userId,
        ticker: { in: tickerList },
        assessmentType: "issuer",
        status: "completed",
      },
      include: issuerAssessmentInclude,
      orderBy: { completedAt: "desc" },
    }),
  ]);

  const draftByTicker = new Map<string, (typeof drafts)[number]>();
  for (const draft of drafts) {
    const prev = draftByTicker.get(draft.ticker);
    if (!prev || draft.updatedAt > prev.updatedAt) draftByTicker.set(draft.ticker, draft);
  }

  const completedByTicker = new Map<string, (typeof completedAssessments)[number]>();
  for (const completed of completedAssessments) {
    if (!completedByTicker.has(completed.ticker)) completedByTicker.set(completed.ticker, completed);
  }

  const rows: RiskPortfolioRow[] = [];
  for (const ticker of tickerList) {
    const assessment = draftByTicker.get(ticker) ?? completedByTicker.get(ticker);
    if (!assessment || assessment.answers.length === 0) continue;

    const scoringInputs = buildScoringInputs(assessment.template.questions, assessment.answers);
    const score = calculateIssuerRiskScore({
      questions: scoringInputs,
      activeDaggers: [],
      manualOverrideScore: toNum(assessment.manualOverrideScore),
      manualOverrideClassification: assessment.manualOverrideClassification,
    });

    const buckets = {} as Record<(typeof ISSUER_RISK_BUCKET_KEYS)[number], number>;
    for (const key of ISSUER_RISK_BUCKET_KEYS) {
      const cat = score.categoryScores.find((c) => c.category === key);
      buckets[key] = roundDisplayScore(cat?.displayScore ?? 0);
    }

    rows.push({
      ticker,
      companyName: companyNameByTicker.get(ticker) ?? ticker,
      compositeScore: roundDisplayScore(toNum(assessment.manualOverrideScore) ?? score.finalScore),
      classification: score.effectiveClassification,
      buckets,
      lastUpdated: assessment.updatedAt.toISOString(),
      status: assessment.status,
    });
  }

  rows.sort((a, b) => a.companyName.localeCompare(b.companyName));
  return rows;
}

export type RiskBucketMatrixCell = {
  answerLabel: UiAnswerLabel;
  pointsEarned: number;
  maxPoints: number;
  scorePercent: number;
};

export type RiskBucketQuestionMatrix = {
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

export async function getRiskBucketQuestionMatrix(
  userId: string,
  category: (typeof ISSUER_RISK_BUCKET_KEYS)[number]
): Promise<RiskBucketQuestionMatrix> {
  const portfolioRows = await getRiskPortfolioRows(userId);
  const categoryLabel = CATEGORY_LABELS[category] ?? category;

  const template = await getActiveIssuerTemplate();
  const questions =
    template?.questions
      .filter((q) => q.category === category)
      .map((q) => ({
        questionCode: q.questionCode,
        questionText: q.questionText,
        shortLabel: issuerRiskQuestionShortLabel(q.questionCode, q.questionText),
        maxPoints: Number(q.maxPoints),
      })) ?? [];

  if (portfolioRows.length === 0 || questions.length === 0) {
    return {
      category,
      categoryLabel,
      questions,
      companies: [],
      cells: {},
    };
  }

  const tickerList = portfolioRows.map((r) => r.ticker);
  const companyNameByTicker = new Map(portfolioRows.map((r) => [r.ticker, r.companyName]));

  const [drafts, completedAssessments] = await Promise.all([
    prisma.riskAssessment.findMany({
      where: {
        userId,
        ticker: { in: tickerList },
        assessmentType: "issuer",
        status: { in: ["draft", "reopened"] },
      },
      include: issuerAssessmentInclude,
    }),
    prisma.riskAssessment.findMany({
      where: {
        userId,
        ticker: { in: tickerList },
        assessmentType: "issuer",
        status: "completed",
      },
      include: issuerAssessmentInclude,
      orderBy: { completedAt: "desc" },
    }),
  ]);

  const draftByTicker = new Map<string, (typeof drafts)[number]>();
  for (const draft of drafts) {
    const prev = draftByTicker.get(draft.ticker);
    if (!prev || draft.updatedAt > prev.updatedAt) draftByTicker.set(draft.ticker, draft);
  }

  const completedByTicker = new Map<string, (typeof completedAssessments)[number]>();
  for (const completed of completedAssessments) {
    if (!completedByTicker.has(completed.ticker)) completedByTicker.set(completed.ticker, completed);
  }

  const cells: Record<string, Record<string, RiskBucketMatrixCell | null>> = {};
  const companies: RiskBucketQuestionMatrix["companies"] = [];

  for (const ticker of tickerList) {
    const assessment = draftByTicker.get(ticker) ?? completedByTicker.get(ticker);
    if (!assessment || assessment.answers.length === 0) continue;

    companies.push({
      ticker,
      companyName: companyNameByTicker.get(ticker) ?? ticker,
    });

    const answerByQuestionId = new Map(assessment.answers.map((a) => [a.questionId, a]));
    const questionByCode = new Map(
      assessment.template.questions
        .filter((q) => q.category === category)
        .map((q) => [q.questionCode, q] as const)
    );

    cells[ticker] = {};
    for (const q of questions) {
      const templateQuestion = questionByCode.get(q.questionCode);
      const answer = templateQuestion ? answerByQuestionId.get(templateQuestion.id) : undefined;
      if (!answer) {
        cells[ticker][q.questionCode] = null;
        continue;
      }

      const maxPoints = Number(templateQuestion?.maxPoints ?? q.maxPoints);
      const answerLabel = answer.answerLabel as UiAnswerLabel;
      const pointsEarned = calculateQuestionPoints(maxPoints, answerLabel);
      const scorePercent =
        maxPoints > 0 && answerLabel !== "not_applicable"
          ? roundDisplayScore((pointsEarned / maxPoints) * 100)
          : 0;

      cells[ticker][q.questionCode] = {
        answerLabel,
        pointsEarned,
        maxPoints,
        scorePercent,
      };
    }
  }

  return {
    category,
    categoryLabel,
    questions,
    companies,
    cells,
  };
}

export async function getRiskWatchlistRows(userId: string, watchlistTickers: string[], query: WatchlistQuery = {}) {
  const summaries = await prisma.riskIssuerSummary.findMany({
    where: { userId, ticker: { in: watchlistTickers } },
  });
  const summaryByTicker = new Map(summaries.map((s) => [s.ticker, s]));

  let rows = watchlistTickers.map((ticker) => {
    const s = summaryByTicker.get(ticker);
    return {
      ticker,
      issuerRiskScore: toNum(s?.effectiveScore),
      issuerRiskScoreRounded: s?.effectiveScore != null ? roundDisplayScore(Number(s.effectiveScore)) : null,
      classification: s?.classification ?? null,
      riskVelocity: toNum(s?.riskVelocity),
      riskVelocityStatus: s?.riskVelocityStatus ?? "Insufficient History",
      activeDaggerCount: s?.activeDaggerCount ?? 0,
      dataConfidence: toNum(s?.dataConfidence),
      lastUpdated: s?.lastUpdatedAt?.toISOString() ?? null,
      nextReviewDate: s?.nextReviewDate?.toISOString() ?? null,
      assessmentOverdue: s?.assessmentOverdue ?? false,
      hasAssessment: Boolean(s?.lastAssessmentId),
    };
  });

  if (query.classification) {
    rows = rows.filter((r) => r.classification === query.classification);
  }
  if (query.minScore != null) {
    rows = rows.filter((r) => (r.issuerRiskScore ?? -1) >= query.minScore!);
  }
  if (query.maxScore != null) {
    rows = rows.filter((r) => (r.issuerRiskScore ?? 101) <= query.maxScore!);
  }
  if (query.daggerOnly) {
    rows = rows.filter((r) => r.activeDaggerCount > 0);
  }
  if (query.rapidlyDeteriorating) {
    rows = rows.filter((r) => r.riskVelocityStatus === "Rapid Deterioration");
  }
  if (query.lowConfidence) {
    rows = rows.filter((r) => (r.dataConfidence ?? 100) < 60);
  }
  if (query.assessmentOverdue) {
    rows = rows.filter((r) => r.assessmentOverdue);
  }
  if (query.noAssessment) {
    rows = rows.filter((r) => !r.hasAssessment);
  }

  const sort = query.sort ?? "priority";
  rows.sort((a, b) => {
    switch (sort) {
      case "score_desc":
        return (b.issuerRiskScore ?? -1) - (a.issuerRiskScore ?? -1);
      case "velocity_desc":
        return (b.riskVelocity ?? -999) - (a.riskVelocity ?? -999);
      case "dagger_desc":
        return b.activeDaggerCount - a.activeDaggerCount;
      case "confidence_asc":
        return (a.dataConfidence ?? 0) - (b.dataConfidence ?? 0);
      default:
        if (b.activeDaggerCount !== a.activeDaggerCount) return b.activeDaggerCount - a.activeDaggerCount;
        if (a.riskVelocityStatus === "Rapid Deterioration" && b.riskVelocityStatus !== "Rapid Deterioration") return -1;
        if (b.riskVelocityStatus === "Rapid Deterioration" && a.riskVelocityStatus !== "Rapid Deterioration") return 1;
        return (b.issuerRiskScore ?? -1) - (a.issuerRiskScore ?? -1);
    }
  });

  return rows;
}

export async function compareAssessments(
  userId: string,
  ticker: string,
  assessmentIdA: string,
  assessmentIdB: string
) {
  const [a, b] = await Promise.all([
    prisma.riskAssessment.findFirst({
      where: { id: assessmentIdA, userId, ticker },
      include: { answers: { include: { question: true } } },
    }),
    prisma.riskAssessment.findFirst({
      where: { id: assessmentIdB, userId, ticker },
      include: { answers: { include: { question: true } } },
    }),
  ]);
  if (!a || !b) throw new Error("Assessment not found");

  const answerMapB = new Map(b.answers.map((x) => [x.questionId, x]));
  const changedAnswers = a.answers
    .map((ans) => {
      const other = answerMapB.get(ans.questionId);
      if (!other || other.answerLabel === ans.answerLabel) return null;
      return {
        questionCode: ans.question.questionCode,
        questionText: ans.question.questionText,
        from: other.answerLabel,
        to: ans.answerLabel,
      };
    })
    .filter(Boolean);

  return {
    a: {
      id: a.id,
      completedAt: a.completedAt?.toISOString() ?? null,
      rawScore: toNum(a.rawScore),
      effectiveScore: toNum(a.effectiveScore),
      classification: a.classification,
    },
    b: {
      id: b.id,
      completedAt: b.completedAt?.toISOString() ?? null,
      rawScore: toNum(b.rawScore),
      effectiveScore: toNum(b.effectiveScore),
      classification: b.classification,
    },
    changedAnswers,
    scoreDelta: (toNum(a.effectiveScore) ?? 0) - (toNum(b.effectiveScore) ?? 0),
  };
}

export async function loadSecurityAssessmentWorkspace(userId: string, ticker: string, securityId: string) {
  const security = await prisma.riskSecurityInstrument.findFirst({
    where: { id: securityId, userId, ticker },
  });
  if (!security) throw new Error("Security not found");

  const template = await getActiveSecurityTemplate();
  if (!template) throw new Error("Security template not found");

  let assessment = await prisma.riskAssessment.findFirst({
    where: {
      userId,
      ticker,
      securityInstrumentId: securityId,
      assessmentType: "security",
      status: { in: ["draft", "reopened"] },
    },
    include: {
      answers: true,
      template: { include: { questions: { where: { isActive: true }, orderBy: { displayOrder: "asc" } } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!assessment) {
    assessment = await prisma.riskAssessment.create({
      data: {
        userId,
        ticker,
        securityInstrumentId: securityId,
        templateId: template.id,
        assessmentType: "security",
        status: "draft",
        createdBy: userId,
      },
      include: {
        answers: true,
        template: { include: { questions: { where: { isActive: true }, orderBy: { displayOrder: "asc" } } } },
      },
    });
  }

  const issuerSummary = await prisma.riskIssuerSummary.findUnique({
    where: { userId_ticker: { userId, ticker } },
  });
  const config = await getOrCreateScoringConfig(userId);
  const scoringInputs = buildScoringInputs(assessment.template.questions, assessment.answers);
  const secScore = calculateSecurityRiskScore(scoringInputs);
  const issuerEffective = toNum(issuerSummary?.effectiveScore) ?? 0;
  const overall =
    issuerEffective > 0 || secScore.rawScore > 0
      ? calculateOverallCreditRiskScore(issuerEffective, secScore.rawScore, {
          issuerWeightPercent: config.issuerWeightPercent,
          securityWeightPercent: config.securityWeightPercent,
        })
      : null;

  const answerByQ = new Map(assessment.answers.map((a) => [a.questionId, a]));

  return {
    security: {
      id: security.id,
      name: security.name,
      cusip: security.cusip,
      isin: security.isin,
      priority: security.priority,
      lienLevel: security.lienLevel,
      maturityDate: security.maturityDate?.toISOString() ?? null,
    },
    assessment: {
      id: assessment.id,
      status: assessment.status,
      lastUpdated: assessment.updatedAt.toISOString(),
    },
    securityRiskScore: secScore.rawScore,
    securityRiskScoreRounded: roundDisplayScore(secScore.rawScore),
    overallCreditRiskScore: overall,
    overallCreditRiskScoreRounded: overall != null ? roundDisplayScore(overall) : null,
    dataConfidence: secScore.dataConfidence,
    questions: assessment.template.questions.map((q) => {
      const a = answerByQ.get(q.id);
      const label = (a?.answerLabel ?? "unknown") as UiAnswerLabel;
      const max = Number(q.maxPoints);
      return {
        id: q.id,
        questionCode: q.questionCode,
        questionText: q.questionText,
        maxPoints: max,
        answerLabel: label,
        calculatedPoints: calculateQuestionPoints(max, label),
        analystComment: a?.analystComment ?? null,
        sourceUrl: a?.sourceUrl ?? null,
      };
    }),
    weights: {
      issuerWeightPercent: config.issuerWeightPercent,
      securityWeightPercent: config.securityWeightPercent,
    },
  };
}

export async function createSecurityInstrument(
  userId: string,
  ticker: string,
  data: {
    name: string;
    cusip?: string | null;
    isin?: string | null;
    priority?: string | null;
    lienLevel?: string | null;
    maturityDate?: string | null;
  }
) {
  return prisma.riskSecurityInstrument.create({
    data: {
      userId,
      ticker,
      name: data.name,
      cusip: data.cusip ?? null,
      isin: data.isin ?? null,
      priority: data.priority ?? null,
      lienLevel: data.lienLevel ?? null,
      maturityDate: parseDate(data.maturityDate),
    },
  });
}
