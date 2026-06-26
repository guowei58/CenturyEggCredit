import { prisma } from "@/lib/prisma";
import { Prisma, type RiskChecklistType } from "@/generated/prisma/client";
import { calculateQuestionPoints } from "./classification";
import {
  DAGGER_FLAG_QUESTIONS,
  DAGGER_TEMPLATE,
  ISSUER_RISK_QUESTIONS,
  ISSUER_RISK_TEMPLATE,
  SECURITY_RISK_QUESTIONS,
  SECURITY_RISK_TEMPLATE,
  type SeedQuestion,
} from "./seed-data";

function decimal(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

async function syncStoredAnswerPointsForTemplate(templateId: string) {
  const questions = await prisma.riskChecklistQuestion.findMany({
    where: { templateId, isActive: true },
    select: { id: true, maxPoints: true },
  });
  if (questions.length === 0) return;

  const questionById = new Map(questions.map((q) => [q.id, Number(q.maxPoints)]));
  const answers = await prisma.riskAssessmentAnswer.findMany({
    where: { questionId: { in: questions.map((q) => q.id) } },
    select: { id: true, questionId: true, answerLabel: true, calculatedPoints: true },
  });

  await Promise.all(
    answers.map((answer) => {
      const max = questionById.get(answer.questionId);
      if (max == null) return Promise.resolve();
      const points = calculateQuestionPoints(max, answer.answerLabel);
      if (Number(answer.calculatedPoints) === points) return Promise.resolve();
      return prisma.riskAssessmentAnswer.update({
        where: { id: answer.id },
        data: { calculatedPoints: decimal(points) },
      });
    })
  );
}

async function upsertTemplateWithQuestions(
  template: { name: string; version: number; checklistType: RiskChecklistType },
  questions: SeedQuestion[]
) {
  const row = await prisma.riskChecklistTemplate.upsert({
    where: {
      name_version_checklistType: {
        name: template.name,
        version: template.version,
        checklistType: template.checklistType,
      },
    },
    create: {
      name: template.name,
      version: template.version,
      checklistType: template.checklistType,
      isActive: true,
    },
    update: { isActive: true },
  });

  let pointsChanged = false;
  for (const q of questions) {
    const existing = await prisma.riskChecklistQuestion.findUnique({
      where: {
        templateId_questionCode: {
          templateId: row.id,
          questionCode: q.questionCode,
        },
      },
      select: { maxPoints: true },
    });
    if (!existing) {
      pointsChanged = true;
    } else if (Number(existing.maxPoints) !== q.maxPoints) {
      pointsChanged = true;
    }

    await prisma.riskChecklistQuestion.upsert({
      where: {
        templateId_questionCode: {
          templateId: row.id,
          questionCode: q.questionCode,
        },
      },
      create: {
        templateId: row.id,
        questionCode: q.questionCode,
        category: q.category,
        questionText: q.questionText,
        maxPoints: q.maxPoints,
        displayOrder: q.displayOrder,
        isDagger: q.isDagger ?? false,
        isActive: true,
      },
      update: {
        category: q.category,
        questionText: q.questionText,
        maxPoints: q.maxPoints,
        displayOrder: q.displayOrder,
        isDagger: q.isDagger ?? false,
        isActive: true,
      },
    });
  }

  if (pointsChanged) {
    await syncStoredAnswerPointsForTemplate(row.id);
  }

  return prisma.riskChecklistTemplate.findUniqueOrThrow({
    where: { id: row.id },
    include: { questions: { orderBy: { displayOrder: "asc" } } },
  });
}

const SEED_SPECS = [
  { template: ISSUER_RISK_TEMPLATE, questions: ISSUER_RISK_QUESTIONS },
  { template: SECURITY_RISK_TEMPLATE, questions: SECURITY_RISK_QUESTIONS },
  { template: DAGGER_TEMPLATE, questions: DAGGER_FLAG_QUESTIONS },
] as const;

let templatesSeedPromise: Promise<void> | null = null;

export async function ensureRiskChecklistTemplatesSeeded() {
  if (!templatesSeedPromise) {
    templatesSeedPromise = (async () => {
      await Promise.all(
        SEED_SPECS.map(({ template, questions }) => upsertTemplateWithQuestions(template, questions))
      );
    })();
  }
  await templatesSeedPromise;
}

export async function getActiveIssuerTemplate() {
  await ensureRiskChecklistTemplatesSeeded();
  return prisma.riskChecklistTemplate.findFirst({
    where: { checklistType: "issuer", isActive: true },
    orderBy: { version: "desc" },
    include: { questions: { where: { isActive: true }, orderBy: { displayOrder: "asc" } } },
  });
}

export async function getActiveSecurityTemplate() {
  await ensureRiskChecklistTemplatesSeeded();
  return prisma.riskChecklistTemplate.findFirst({
    where: { checklistType: "security", isActive: true },
    orderBy: { version: "desc" },
    include: { questions: { where: { isActive: true }, orderBy: { displayOrder: "asc" } } },
  });
}
