import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { calculateIssuerRiskScore } from "../src/lib/risk-checklist/scoring";
import { roundDisplayScore } from "../src/lib/risk-checklist/classification";
import { CATEGORY_LABELS } from "../src/lib/risk-checklist/seed-data";
import type { RiskAnswerLabel } from "../src/lib/risk-checklist/types";

function answerMultiplier(label: RiskAnswerLabel): number | null {
  if (label === "not_applicable") return null;
  if (label === "no") return 0;
  if (label === "yes") return 1;
  return 0.5;
}

async function main() {
  const drafts = await prisma.riskAssessment.findMany({
    where: { assessmentType: "issuer", status: { in: ["draft", "reopened"] } },
    include: {
      user: { select: { email: true } },
      template: {
        include: {
          questions: { where: { isActive: true }, orderBy: { displayOrder: "asc" } },
        },
      },
      answers: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  if (drafts.length === 0) {
    console.log("No draft issuer assessments found.");
    return;
  }

  for (const draft of drafts) {
    const answerByQ = new Map(draft.answers.map((a) => [a.questionId, a]));
    const questions = draft.template.questions.map((q) => {
      const a = answerByQ.get(q.id);
      return {
        questionId: q.id,
        questionCode: q.questionCode,
        category: q.category,
        maxPoints: Number(q.maxPoints),
        answerLabel: (a?.answerLabel ?? "unknown") as RiskAnswerLabel,
      };
    });

    const score = calculateIssuerRiskScore({ questions, activeDaggers: [] });

    console.log("\n" + "=".repeat(72));
    console.log(`Ticker: ${draft.ticker} | User: ${draft.user.email}`);
    console.log(`Updated: ${draft.updatedAt.toISOString()}`);

    let totalEarned = 0;
    let totalApplicable = 0;
    const byCat = new Map<string, { earned: number; applicable: number; rows: string[] }>();

    for (const q of questions) {
      const mult = answerMultiplier(q.answerLabel);
      const earned = mult == null ? null : q.maxPoints * mult;
      if (!byCat.has(q.category)) byCat.set(q.category, { earned: 0, applicable: 0, rows: [] });
      const bucket = byCat.get(q.category)!;
      if (earned != null) {
        totalApplicable += q.maxPoints;
        totalEarned += earned;
        bucket.earned += earned;
        bucket.applicable += q.maxPoints;
      }
      bucket.rows.push(
        `  ${q.questionCode}  ${q.answerLabel.padEnd(16)} max=${q.maxPoints.toFixed(2)}  earned=${earned == null ? "excluded" : earned.toFixed(4)}`
      );
    }

    console.log(`\nCOMPOSITE`);
    console.log(
      `  ${totalEarned.toFixed(4)} earned ÷ ${totalApplicable.toFixed(4)} applicable × 100 = ${score.rawScore.toFixed(4)}%`
    );
    console.log(`  rounded for display: ${roundDisplayScore(score.rawScore)}`);

    for (const catRow of score.categoryScores) {
      const label = CATEGORY_LABELS[catRow.category] ?? catRow.category;
      const rounded = roundDisplayScore(catRow.displayScore);
      console.log(`\n${label.toUpperCase()}`);
      console.log(
        `  ${catRow.earnedPoints.toFixed(4)} earned ÷ ${catRow.applicableMaxPoints.toFixed(4)} applicable × 100 = ${catRow.displayScore.toFixed(4)}%`
      );
      console.log(`  rounded for display: ${rounded}`);
      for (const line of byCat.get(catRow.category)?.rows ?? []) console.log(line);
    }

    const fromRoundedBuckets =
      score.categoryScores.reduce((sum, c) => sum + roundDisplayScore(c.displayScore) * c.applicableMaxPoints, 0) /
      totalApplicable;
    console.log(`\nWHY NOT AVERAGE OF ROUNDED BUCKET CARDS?`);
    console.log(
      `  (40×${roundDisplayScore(score.categoryScores.find((c) => c.category === "industry_business")?.displayScore ?? 0)} + …) / 100 using NOMINAL weights would mislead.`
    );
    console.log(`  Actual: sum(earned)/sum(applicable) = ${(totalEarned / totalApplicable) * 100}%`);
    console.log(
      `  If you wrongly do sum(ROUNDED bucket % × applicable) / totalApplicable: ${fromRoundedBuckets.toFixed(4)}%`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
