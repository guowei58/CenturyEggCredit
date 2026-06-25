import { classifyRiskVelocity } from "./classification";

export type VelocitySnapshot = {
  effectiveScore: number;
  completedAt: Date;
};

export function calculateRiskVelocity(
  currentEffectiveScore: number,
  history: VelocitySnapshot[],
  now: Date = new Date()
): { delta: number | null; status: ReturnType<typeof classifyRiskVelocity> } {
  const msPerDay = 24 * 60 * 60 * 1000;
  const target = now.getTime() - 90 * msPerDay;
  const minWindow = now.getTime() - 105 * msPerDay;
  const maxWindow = now.getTime() - 75 * msPerDay;

  const completed = history
    .filter((h) => h.completedAt.getTime() < now.getTime())
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());

  if (completed.length === 0) {
    return { delta: null, status: classifyRiskVelocity(null) };
  }

  let prior: VelocitySnapshot | null = null;
  let bestDistance = Infinity;

  for (const snap of completed) {
    const t = snap.completedAt.getTime();
    if (t >= minWindow && t <= maxWindow) {
      const dist = Math.abs(t - target);
      if (dist < bestDistance) {
        bestDistance = dist;
        prior = snap;
      }
    }
  }

  if (!prior) {
    return { delta: null, status: classifyRiskVelocity(null) };
  }

  const delta = currentEffectiveScore - prior.effectiveScore;
  return { delta, status: classifyRiskVelocity(delta) };
}

export function calculateOptionalVelocityWindows(
  currentEffectiveScore: number,
  history: VelocitySnapshot[],
  now: Date = new Date()
): { days30: number | null; days180: number | null } {
  const msPerDay = 24 * 60 * 60 * 1000;
  const findDelta = (days: number) => {
    const target = now.getTime() - days * msPerDay;
    const prior = history
      .filter((h) => h.completedAt.getTime() <= target)
      .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())[0];
    return prior ? currentEffectiveScore - prior.effectiveScore : null;
  };
  return { days30: findDelta(30), days180: findDelta(180) };
}
