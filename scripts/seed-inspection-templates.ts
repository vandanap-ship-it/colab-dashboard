/**
 * Idempotent seed for the White Lotus inspection checklist templates.
 *
 * Reads {@link ../prisma/inspection-templates-data.ts} and upserts every
 * template by code. Kept in a plain script rather than a migration so
 * copy edits (fixing a checklist typo, adding a new template) don't
 * force a schema migration and don't need admin credentials to apply.
 *
 * Wired into `npm run build` so every Vercel deploy converges the DB
 * to whatever the data file currently says. Local runs use the same
 * DATABASE_URL as the app; unset it (or set SKIP_TEMPLATE_SEED=1) to
 * skip.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { INSPECTION_TEMPLATES } from "../prisma/inspection-templates-data";

async function main() {
  if (process.env.SKIP_TEMPLATE_SEED === "1") {
    console.log("[seed-templates] SKIP_TEMPLATE_SEED=1 — skipping.");
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.log("[seed-templates] DATABASE_URL not set — skipping (safe for CI without DB).");
    return;
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    for (const t of INSPECTION_TEMPLATES) {
      await prisma.$transaction(async (tx) => {
        const tpl = await tx.inspectionTemplate.upsert({
          where: { code: t.code },
          update: {
            name: t.name,
            activity: t.activity ?? null,
            module: t.module ?? null,
            orderIndex: t.orderIndex,
            active: true,
          },
          create: {
            code: t.code,
            name: t.name,
            activity: t.activity ?? null,
            module: t.module ?? null,
            orderIndex: t.orderIndex,
          },
        });
        // Replace item set so the data file is the source of truth —
        // matches the admin route's behavior exactly.
        await tx.inspectionTemplateItem.deleteMany({ where: { templateId: tpl.id } });
        await tx.inspectionTemplateItem.createMany({
          data: t.items.map((i) => ({
            templateId: tpl.id,
            seq: i.seq,
            section: i.section ?? null,
            description: i.description,
          })),
        });
      });
      console.log(`[seed-templates] ${t.code} — ${t.items.length} items`);
    }
    console.log(`[seed-templates] Done. ${INSPECTION_TEMPLATES.length} templates converged.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // A seed failure should NOT break the deploy — the admin route is
  // still available to re-apply by hand, and the previous checklist
  // set is still in the DB.
  console.error("[seed-templates] failed:", err);
  process.exit(0);
});
