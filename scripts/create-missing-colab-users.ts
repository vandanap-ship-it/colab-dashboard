/**
 * One-shot: creates three users who exist in Colab but not Siddhi,
 * so the 2026-10-01 Colab import can resolve their names on the
 * second pass. Idempotent — a user that already exists is left alone.
 *
 *   DATABASE_URL="postgresql://..." \
 *   ALLOW_USER_CREATE=1 \
 *   USER_PASSWORD="<named-user password>" \
 *   npx tsx scripts/create-missing-colab-users.ts
 *
 * USER_PASSWORD is the shared named-user password Siddhi uses on real
 * accounts (same as nagarjuna.c, girish.r, etc). Stored only as a bcrypt
 * hash on each row; the plaintext never lands in git.
 *
 * Users created (all SITE_ENGINEER, modules locked to SAFETY per their
 * Colab designations):
 *
 *   rohan.s     Rohan Kumar Shah  SITE_ENGINEER  WL staff (reports to Abhishek)
 *   mohd.a      Mohd Asif         SITE_ENGINEER  Elegant Constructions (contractor-side)
 *   harshit.g   Harshit Gowda     SITE_ENGINEER  Elegant Constructions (maker for inductions)
 */

import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_USER_CREATE !== "1") {
  console.error(
    "Refusing to run against Neon without ALLOW_USER_CREATE=1.",
  );
  process.exit(1);
}

const password = process.env.USER_PASSWORD;
if (!password || password.length < 4) {
  console.error("USER_PASSWORD env var required (≥4 chars).");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const SAFETY_MODULES = JSON.stringify(["SAFETY"]);

type Spec = {
  username: string;
  name: string;
  email: string;
  designation: string;
  contractorName: string | null;
};

const SPECS: Spec[] = [
  {
    username: "rohan.s",
    name: "Rohan Kumar Shah",
    email: "1206rohankumar1989@gmail.com",
    designation: "Safety Supervisor",
    contractorName: null, // White Lotus internal staff
  },
  {
    username: "mohd.a",
    name: "Mohd Asif",
    email: "elegantconwl@gmail.com",
    designation: "Safety Officer",
    contractorName: "Elegant Constructions",
  },
  {
    username: "harshit.g",
    name: "Harshit Gowda",
    email: "elegantconwl01@gmail.com",
    designation: "Quality Engineer",
    contractorName: "Elegant Constructions",
  },
];

async function main() {
  // Non-null assertion: TypeScript's module-scope narrowing from the
  // `if (!password) process.exit(1)` check above doesn't persist into
  // this async closure. Build-time typecheck sees `password` as
  // `string | undefined` here; runtime it is always `string`.
  const passwordHash = await bcrypt.hash(password!, 10);

  for (const spec of SPECS) {
    const existing = await prisma.user.findUnique({
      where: { username: spec.username },
      select: { id: true, name: true },
    });
    if (existing) {
      console.log(`  = ${spec.username} (${existing.name}) already exists — leaving alone`);
      continue;
    }

    // Also check by name match in case the username differs — don't
    // create a duplicate for a user who's already there under a
    // different handle.
    const byName = await prisma.user.findFirst({
      where: { name: { equals: spec.name, mode: "insensitive" } },
      select: { id: true, username: true },
    });
    if (byName) {
      console.log(`  = ${spec.name} already exists as "${byName.username}" — leaving alone`);
      continue;
    }

    let contractorId: string | null = null;
    if (spec.contractorName) {
      const c = await prisma.contractor.findFirst({
        where: { name: { equals: spec.contractorName, mode: "insensitive" } },
        select: { id: true },
      });
      if (!c) {
        console.warn(`  ! ${spec.username}: contractor "${spec.contractorName}" not found — creating user without contractor link`);
      } else {
        contractorId = c.id;
      }
    }

    const created = await prisma.user.create({
      data: {
        username: spec.username,
        name: spec.name,
        email: spec.email,
        passwordHash,
        role: "SITE_ENGINEER",
        designation: spec.designation,
        modules: SAFETY_MODULES,
        contractorId,
        active: true,
        canApproveWorkPermits: false,
      },
      select: { id: true, username: true },
    });
    console.log(`  + ${created.username} (${spec.name}) created · id=${created.id}`);
  }

  console.log("");
  console.log("Done. Hand the shared named-user password to the three users.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
