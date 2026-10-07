// ---------------------------------------------------------------------------
// Register due-date cron — Vercel Cron endpoint.
//
// Fires once a day at 06:15 IST (00:45 UTC, per vercel.json). Three passes
// over every live register row / register:
//
//   1. Due soon — rows whose next due date is today or within the next
//      DUE_SOON_DAYS. One push per register to the people who keep it
//      (row editors + last sign-off preparer), listing the items.
//
//   2. Overdue — rows past their due date. One push per register to the
//      maintainers AND the approver (Girish), since an overdue fire
//      extinguisher is a site safety gap.
//
//   3. Sign-off due — registers with live rows whose last pending /
//      approved sign-off is older than the type's interval (monthly for
//      fire extinguishers). Pushes the maintainers; repeats weekly until
//      someone submits.
//
// Each reminder fires once per due date: rows carry dueSoonNotifiedAt /
// overdueNotifiedAt (cleared whenever the due date changes) and the
// register carries signOffNudgedAt (cleared on submit). Re-running the
// cron the same day is a no-op.
//
// Manual test: with `next dev` and CRON_SECRET set, call
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     http://localhost:3000/api/cron/register-due
// → { dueSoon: N, overdue: M, signOffNudges: K }.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { istDayStart } from "@/lib/istDay";
import { DUE_SOON_DAYS, isSignOffDue } from "@/lib/registers";
import { findRegisterApprovers, findRegisterMaintainers } from "@/lib/registersServer";

const DAY_MS = 24 * 60 * 60 * 1000;
const SIGN_OFF_RENUDGE_DAYS = 7;

type DueRow = {
  id: string;
  identifier: string;
  registerId: string;
  register: { projectId: string; type: { code: string; shortName: string; module: string } };
};

function groupByRegister(rows: DueRow[]): Map<string, DueRow[]> {
  const m = new Map<string, DueRow[]>();
  for (const r of rows) {
    const list = m.get(r.registerId) ?? [];
    list.push(r);
    m.set(r.registerId, list);
  }
  return m;
}

function countLabel(n: number, shortName: string): string {
  const plural = shortName.toLowerCase();
  return `${n} ${n === 1 ? plural.replace(/s$/, "") : plural}`;
}

function listIds(rows: DueRow[]): string {
  const ids = rows.map((r) => r.identifier);
  return ids.length > 6 ? `${ids.slice(0, 6).join(", ")} +${ids.length - 6} more` : ids.join(", ");
}

const rowSelect = {
  id: true,
  identifier: true,
  registerId: true,
  register: { select: { projectId: true, type: { select: { code: true, shortName: true, module: true } } } },
} as const;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured on this deployment." }, { status: 503 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // nextDueDate is a calendar day stored as UTC midnight; compare against
  // the IST calendar day so a 06:15 IST run sees the right "today".
  const today = istDayStart(now);
  const soonCutoff = new Date(today.getTime() + DUE_SOON_DAYS * DAY_MS);
  const liveRow = { deletedAt: null, retiredAt: null, register: { type: { active: true } } } as const;

  // Pass 1 — due soon.
  const dueSoon = await prisma.registerRow.findMany({
    where: { ...liveRow, nextDueDate: { gte: today, lte: soonCutoff }, dueSoonNotifiedAt: null },
    select: rowSelect,
  });
  let dueSoonPushes = 0;
  for (const [registerId, rows] of groupByRegister(dueSoon)) {
    const { projectId, type } = rows[0].register;
    const recipients = await findRegisterMaintainers(registerId, type.module);
    await Promise.allSettled(
      recipients.map((uid) =>
        sendPushToUser(uid, {
          title: `${countLabel(rows.length, type.shortName)} due for inspection soon`,
          body: `${listIds(rows)} — due within ${DUE_SOON_DAYS} days. Inspect and update the register.`,
          url: `/mobile/${projectId}/registers/${type.code}?filter=due_soon`,
          tag: `register-due-soon-${registerId}`,
        }),
      ),
    );
    dueSoonPushes += recipients.length;
    await prisma.registerRow.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { dueSoonNotifiedAt: now },
    });
  }

  // Pass 2 — overdue.
  const overdue = await prisma.registerRow.findMany({
    where: { ...liveRow, nextDueDate: { lt: today }, overdueNotifiedAt: null },
    select: rowSelect,
  });
  let overduePushes = 0;
  for (const [registerId, rows] of groupByRegister(overdue)) {
    const { projectId, type } = rows[0].register;
    const [maintainers, approvers] = await Promise.all([
      findRegisterMaintainers(registerId, type.module),
      findRegisterApprovers(type.module),
    ]);
    const recipients = Array.from(new Set([...maintainers, ...approvers.map((a) => a.id)]));
    await Promise.allSettled(
      recipients.map((uid) =>
        sendPushToUser(uid, {
          title: `${countLabel(rows.length, type.shortName)} overdue for inspection`,
          body: `${listIds(rows)} — past the due date. Inspect them and update the register.`,
          url: `/mobile/${projectId}/registers/${type.code}?filter=overdue`,
          tag: `register-overdue-${registerId}`,
        }),
      ),
    );
    overduePushes += recipients.length;
    await prisma.registerRow.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { overdueNotifiedAt: now },
    });
  }

  // Pass 3 — monthly sign-off due.
  const registers = await prisma.register.findMany({
    where: {
      type: { active: true, signOffIntervalDays: { not: null } },
      OR: [
        { signOffNudgedAt: null },
        { signOffNudgedAt: { lt: new Date(now.getTime() - SIGN_OFF_RENUDGE_DAYS * DAY_MS) } },
      ],
    },
    select: {
      id: true,
      projectId: true,
      type: { select: { code: true, shortName: true, module: true, signOffIntervalDays: true } },
      submissions: {
        where: { status: { in: ["PENDING", "APPROVED"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
      _count: { select: { rows: { where: { deletedAt: null, retiredAt: null } } } },
    },
  });
  let signOffNudges = 0;
  for (const reg of registers) {
    const latest = reg.submissions[0]?.createdAt ?? null;
    if (!isSignOffDue(latest, reg.type.signOffIntervalDays, now, reg._count.rows)) continue;
    const recipients = await findRegisterMaintainers(reg.id, reg.type.module);
    await Promise.allSettled(
      recipients.map((uid) =>
        sendPushToUser(uid, {
          title: `${reg.type.shortName} register: monthly sign-off due`,
          body: latest
            ? "It's been a month since the last sign-off. Check the list and submit it for sign-off."
            : "The register hasn't been signed off yet. Check the list and submit it for sign-off.",
          url: `/mobile/${reg.projectId}/registers/${reg.type.code}`,
          tag: `register-signoff-due-${reg.id}`,
        }),
      ),
    );
    signOffNudges += recipients.length;
    await prisma.register.update({ where: { id: reg.id }, data: { signOffNudgedAt: now } });
  }

  return NextResponse.json({
    dueSoon: dueSoon.length,
    overdue: overdue.length,
    dueSoonPushes,
    overduePushes,
    signOffNudges,
  });
}
