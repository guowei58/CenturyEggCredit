import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const now = new Date();
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

  const dayKeys: string[] = [];
  for (let i = 0; i < 10; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      passwordHash: true,
      accounts: { select: { provider: true } },
      sessions: { select: { expires: true } },
    },
    orderBy: { email: "asc" },
  });

  const [tickerDocRows, workspaceRows, aiChatRows, eggHocRows, dailyNewsRows, savedDocRows, prefRows] =
    await Promise.all([
      prisma.userTickerDocument.findMany({
        where: { updatedAt: { gte: tenDaysAgo } },
        select: { userId: true, updatedAt: true },
      }),
      prisma.userTickerWorkspaceFile.findMany({
        where: { updatedAt: { gte: tenDaysAgo } },
        select: { userId: true, updatedAt: true },
      }),
      prisma.userAiChatState.findMany({
        where: { updatedAt: { gte: tenDaysAgo } },
        select: { userId: true, updatedAt: true },
      }),
      prisma.eggHocMessage.findMany({
        where: { createdAt: { gte: tenDaysAgo } },
        select: { senderUserId: true, createdAt: true },
      }),
      prisma.userDailyNewsBatch.findMany({
        where: { createdAt: { gte: tenDaysAgo } },
        select: { userId: true, createdAt: true },
      }),
      prisma.userSavedDocument.findMany({
        where: { createdAt: { gte: tenDaysAgo } },
        select: { userId: true, createdAt: true },
      }),
      prisma.userPreferences.findMany({
        where: { updatedAt: { gte: tenDaysAgo } },
        select: { userId: true, updatedAt: true },
      }),
    ]);

  type Activity = { lastActive: Date | null; activeDays: Set<string> };
  const activityByUser = new Map<string, Activity>();

  function noteActivity(userId: string, at: Date) {
    if (!activityByUser.has(userId)) {
      activityByUser.set(userId, { lastActive: null, activeDays: new Set() });
    }
    const row = activityByUser.get(userId)!;
    row.activeDays.add(at.toISOString().slice(0, 10));
    if (!row.lastActive || at > row.lastActive) row.lastActive = at;
  }

  for (const r of tickerDocRows) noteActivity(r.userId, r.updatedAt);
  for (const r of workspaceRows) noteActivity(r.userId, r.updatedAt);
  for (const r of aiChatRows) noteActivity(r.userId, r.updatedAt);
  for (const r of eggHocRows) noteActivity(r.senderUserId, r.createdAt);
  for (const r of dailyNewsRows) noteActivity(r.userId, r.createdAt);
  for (const r of savedDocRows) noteActivity(r.userId, r.createdAt);
  for (const r of prefRows) noteActivity(r.userId, r.updatedAt);

  for (const u of users) {
    for (const s of u.sessions) {
      if (s.expires >= tenDaysAgo) {
        noteActivity(u.id, s.expires);
      }
    }
  }

  const rows = users.map((u) => {
    const act = activityByUser.get(u.id);
    const activeDaysInWindow = act
      ? [...act.activeDays].filter((d) => dayKeys.includes(d)).sort()
      : [];
    const providers =
      u.accounts.map((a) => a.provider).join(", ") || (u.passwordHash ? "credentials" : "—");
    return {
      email: u.email ?? "(no email)",
      name: u.name ?? "—",
      providers,
      lastActive: act?.lastActive?.toISOString().slice(0, 19) ?? null,
      activeDaysLast10: activeDaysInWindow.length,
      activeDayList: activeDaysInWindow.join(", "),
      consistent: activeDaysInWindow.length >= 8,
    };
  });

  console.log(`Window: ${dayKeys[dayKeys.length - 1]} through ${dayKeys[0]} (UTC dates)`);
  console.log(`\n=== ALL USERS (${users.length}) ===\n`);
  for (const r of rows) {
    console.log(`${r.email}\t${r.name}\t${r.providers}\tlast=${r.lastActive ?? "never"}\tdays=${r.activeDaysLast10}`);
  }

  console.log(`\n=== CONSISTENT (8+ active days in last 10) ===\n`);
  const consistent = rows.filter((x) => x.consistent);
  if (consistent.length === 0) {
    console.log("(none)");
  } else {
    for (const r of consistent) {
      console.log(`${r.email}\t${r.name}\t${r.activeDaysLast10} days\t${r.activeDayList}`);
    }
  }

  console.log(`\n=== ANY ACTIVITY (sorted by active days) ===\n`);
  for (const r of rows.filter((x) => x.activeDaysLast10 > 0).sort((a, b) => b.activeDaysLast10 - a.activeDaysLast10)) {
    console.log(`${r.email}\t${r.name}\t${r.activeDaysLast10} days\t${r.activeDayList}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
