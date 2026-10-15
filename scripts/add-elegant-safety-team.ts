/**
 * One-shot: Elegant Constructions safety-team setup
 * (Vandana 2026-10-15 post-walkthrough).
 *
 *   1. Create user "gladson" (Gladson, Elegant safety team, NOT an
 *      approver). Idempotent — skipped if already exists.
 *   2. Promote user "mohd.a" (Mohd Asif) to canApproveWorkPermits=true
 *      so he can approve HSE Checklists and Work Permits raised by
 *      Elegant's team. Idempotent — skipped if the flag is already on.
 *
 *   DATABASE_URL="postgresql://..." \
 *   ALLOW_USER_CREATE=1 \
 *   USER_PASSWORD="<named-user password>" \
 *   GLADSON_EMAIL="optional@email.id" \
 *   npx tsx scripts/add-elegant-safety-team.ts
 *
 * USER_PASSWORD is the shared named-user password Siddhi uses on real
 * accounts; the plaintext never lands in git. GLADSON_EMAIL is
 * optional — leave unset to create Gladson without an email (he
 * won't receive assignment / milestone notifications until Vandana
 * updates it from Admin > Users).
 */

import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_USER_CREATE !== "1") {
  console.error("Refusing to run against Neon without ALLOW_USER_CREATE=1.");
  process.exit(1);
}

const password = process.env.USER_PASSWORD;
if (!password || password.length < 4) {
  console.error("USER_PASSWORD env var required (≥4 chars).");
  process.exit(1);
}
const gladsonEmail = process.env.GLADSON_EMAIL?.trim() || null;

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const SAFETY_MODULES = JSON.stringify(["SAFETY"]);

async function main() {
  // Non-null assertion survives the async closure (see sibling scripts).
  const passwordHash = await bcrypt.hash(password!, 10);

  // 1 ─ Create Gladson on Elegant's safety team, non-approver.
  const existingGladson = await prisma.user.findFirst({
    where: {
      OR: [
        { username: "gladson" },
        { name: { equals: "Gladson", mode: "insensitive" } },
      ],
    },
    select: { id: true, username: true, name: true },
  });
  if (existingGladson) {
    console.log(`= gladson already exists as "${existingGladson.username}" (${existingGladson.name}) — leaving alone`);
  } else {
    const elegant = await prisma.contractor.findFirst({
      where: { name: { equals: "Elegant Constructions", mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (!elegant) {
      console.error("! Elegant Constructions contractor not found — aborting gladson create. Add the contractor first.");
      process.exit(1);
    }
    const created = await prisma.user.create({
      data: {
        username: "gladson",
        name: "Gladson",
        email: gladsonEmail,
        passwordHash,
        role: "SITE_ENGINEER",
        designation: "Safety Team",
        modules: SAFETY_MODULES,
        contractorId: elegant.id,
        active: true,
        canApproveWorkPermits: false,
      },
      select: { id: true, username: true },
    });
    console.log(`+ ${created.username} (Gladson) created on Elegant · id=${created.id}${gladsonEmail ? "" : " · no email set"}`);
  }

  // 2 ─ Promote Mohd Asif (mohd.a) to safety approver.
  const asif = await prisma.user.findUnique({
    where: { username: "mohd.a" },
    select: {
      id: true,
      name: true,
      canApproveWorkPermits: true,
      active: true,
      modules: true,
      contractor: { select: { name: true } },
    },
  });
  if (!asif) {
    console.error('! User "mohd.a" (Mohd Asif) not found — can\'t promote. Run create-missing-colab-users.ts first.');
    process.exit(1);
  }
  if (!asif.active) {
    console.error('! "mohd.a" is deactivated — cannot promote an inactive user. Fix the account first.');
    process.exit(1);
  }
  if (asif.canApproveWorkPermits) {
    console.log(`= mohd.a (${asif.name}) is already a safety approver — leaving alone`);
  } else {
    await prisma.user.update({
      where: { id: asif.id },
      data: { canApproveWorkPermits: true },
    });
    console.log(`+ mohd.a (${asif.name}) promoted · canApproveWorkPermits=true · contractor=${asif.contractor?.name ?? "none"}`);
  }

  console.log("");
  console.log("Done.");
  console.log("");
  console.log("Elegant raisers of HSE Checklists + Work Permits will now route to Asif.");
  console.log("Gladson can log in and raise safety work for review but can't approve.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
