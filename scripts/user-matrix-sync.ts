/**
 * One-off: aligns Siddhi users with Shraddha's 2026-10-01 user matrix
 * for the Site Team User Guide.
 *
 *   1. Harshit Gowda — modules go from ["SAFETY"] → ["QAQC"]
 *      (he's a Quality Engineer at Elegant Constructions; swap per
 *      Shraddha so the Siddhi scope matches the guide).
 *   2. Samarth Patil — create as a new in-house execution user
 *      modelled on Harish BS (Senior Site Engineer, no contractor
 *      link, modules={null} for full access). Password = USER_PASSWORD
 *      env (same shared value as other named users).
 *
 *   DATABASE_URL="postgresql://..." \
 *   ALLOW_USER_MATRIX_SYNC=1 \
 *   USER_PASSWORD="Wlg123" \
 *   npx tsx scripts/user-matrix-sync.ts
 *
 * Idempotent — re-running leaves Samarth alone if he already exists
 * and only writes Harshit's modules row when it differs from target.
 */

import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_USER_MATRIX_SYNC !== "1") {
  console.error("Refusing to run: set ALLOW_USER_MATRIX_SYNC=1 to run against Neon.");
  process.exit(1);
}
const password = process.env.USER_PASSWORD;
if (!password || password.length < 4) {
  console.error("USER_PASSWORD env var required (≥4 chars).");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main() {
  // 1. Swap Harshit's modules to QAQC.
  const harshit = await prisma.user.findUnique({
    where: { username: "harshit.g" },
    select: { id: true, name: true, modules: true },
  });
  if (!harshit) {
    console.warn("  ! harshit.g not found — skipping module swap");
  } else {
    const target = JSON.stringify(["QAQC"]);
    if (harshit.modules === target) {
      console.log(`  = harshit.g already on QAQC — leaving alone`);
    } else {
      await prisma.user.update({
        where: { id: harshit.id },
        data: { modules: target, designation: "Quality Engineer" },
      });
      console.log(`  ~ harshit.g modules: ${harshit.modules ?? "null"} → ${target}`);
    }
  }

  // 2. Create Samarth Patil if missing. Template matches Harish BS:
  //    in-house, modules=null (full access), no contractor link.
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { username: "samarth.p" },
        { name: { contains: "Samarth", mode: "insensitive" } },
      ],
    },
    select: { id: true, username: true, name: true },
  });
  if (existing) {
    console.log(`  = ${existing.username} (${existing.name}) already exists — leaving alone`);
  } else {
    // Mirror Harish's shape (role + designation level) so Samarth lands
    // in the same My Actions queues etc. Without a known email yet,
    // use the WL-domain placeholder — Shraddha can correct via admin UI.
    const harish = await prisma.user.findUnique({
      where: { username: "harish.bs" },
      select: { role: true, modules: true, canApproveWorkPermits: true },
    });
    if (!harish) {
      console.error("Can't mirror Harish — harish.bs not found.");
      process.exit(1);
    }
    const passwordHash = await bcrypt.hash(password!, 10);
    const created = await prisma.user.create({
      data: {
        username: "samarth.p",
        name: "Samarth Patil",
        email: "samarth.p@whitelotusgroup.in", // placeholder, Shraddha to confirm
        passwordHash,
        role: harish.role,
        designation: "Senior Execution Engineer",
        modules: harish.modules, // null = full access, same as Harish
        canApproveWorkPermits: harish.canApproveWorkPermits,
        contractorId: null,
        active: true,
      },
      select: { id: true, username: true, name: true },
    });
    console.log(`  + ${created.username} (${created.name}) created · id=${created.id}`);
    console.log(`    Placeholder email: samarth.p@whitelotusgroup.in — confirm/update in /admin/users`);
  }

  console.log("");
  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
