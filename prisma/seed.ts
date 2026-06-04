import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

/**
 * Same Postgres adapter as src/lib/prisma.ts. DATABASE_URL must be a Postgres
 * connection string (Neon in prod, local Postgres in dev).
 */
function buildPrisma() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (Postgres connection string)");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
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
