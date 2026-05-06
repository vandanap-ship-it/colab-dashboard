import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import bcrypt from "bcryptjs";

/**
 * Picks the right Prisma adapter based on DATABASE_URL — same logic as
 * src/lib/prisma.ts. Lets us run the seed against either local SQLite or
 * production Turso.
 */
function buildPrisma() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";

  if (url.startsWith("libsql://") || url.startsWith("https://")) {
    const adapter = new PrismaLibSql({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    return new PrismaClient({ adapter });
  }

  const fileUrl = url.startsWith("file:") ? url.slice("file:".length) : url;
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: fileUrl }) });
}

const prisma = buildPrisma();

async function main() {
  const passwordHash = await bcrypt.hash("password", 10);

  const users = [
    { username: "admin", name: "Asha Admin", role: "ADMIN" },
    { username: "planner", name: "Priya Planner", role: "PLANNER" },
    { username: "product", name: "Pooja Product", role: "PRODUCT_TEAM" },
    { username: "manager", name: "Manju Manager", role: "SITE_MANAGER" },
    { username: "engineer", name: "Eshan Engineer", role: "SITE_ENGINEER" },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: { ...u, passwordHash },
    });
  }

  const admin = await prisma.user.findUnique({ where: { username: "admin" } });
  if (!admin) throw new Error("admin user missing");

  const existing = await prisma.project.findFirst({ where: { name: "Amanvana" } });
  const project =
    existing ??
    (await prisma.project.create({
      data: {
        name: "Amanvana",
        code: "AMV",
        status: "ACTIVE",
        startDate: new Date("2025-09-16"),
        endDate: new Date("2026-02-20"),
        address: "IVC Rd, Neraganahalli, Karnataka 562110",
        tagline: "HOME OF SANCTUARIES · AMANVANA",
        createdById: admin.id,
      },
    }));

  const contractorCount = await prisma.contractor.count({ where: { projectId: project.id } });
  if (contractorCount === 0) {
    await prisma.contractor.createMany({
      data: [
        { projectId: project.id, name: "Plumbing Co.", category: "Plumbing" },
        { projectId: project.id, name: "HS Fabrications", category: "MS Fabrication" },
        { projectId: project.id, name: "Studio Aamavi", category: "Carpentry" },
        { projectId: project.id, name: "Finishing Crew", category: "Finishing" },
        { projectId: project.id, name: "External Devs", category: "External Development" },
      ],
    });
  }

  console.log(`Seeded ${users.length} users + project ${project.name}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
