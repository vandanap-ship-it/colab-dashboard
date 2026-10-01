/**
 * One-off: revert PER-EKYT8X (Colab permit 10068537, HOT WORK PERMIT
 * on Villa 12 / Sub Level, workDate 2026-10-06) back to PENDING.
 *
 * Shraddha test-approved it while verifying Girish's My Actions flow
 * for the 2026-10-01 handover; the real Colab state is still pending
 * so we match Colab's reality for day 1.
 *
 *   DATABASE_URL="postgresql://..." \
 *   ALLOW_PERMIT_REVERT=1 \
 *   npx tsx scripts/revert-permit-ekyt8x.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_PERMIT_REVERT !== "1") {
  console.error("Refusing to run: set ALLOW_PERMIT_REVERT=1 to run against Neon.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main() {
  const permit = await prisma.workPermit.findUnique({
    where: { idempotencyKey: "colab-permit:10068537" },
    select: { id: true, displayId: true, status: true, approvedById: true, approvedAt: true },
  });
  if (!permit) {
    console.error("Permit not found by idempotencyKey colab-permit:10068537");
    process.exit(1);
  }
  console.log("Before:", JSON.stringify(permit, null, 2));

  const updated = await prisma.workPermit.update({
    where: { id: permit.id },
    data: {
      status: "PENDING",
      approvedById: null,
      approvedAt: null,
    },
    select: { id: true, displayId: true, status: true, approvedById: true, approvedAt: true },
  });
  console.log("After: ", JSON.stringify(updated, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
