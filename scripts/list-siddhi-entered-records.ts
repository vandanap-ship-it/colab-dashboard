/**
 * Lists every progress and manpower entry the team entered directly in
 * Siddhi (i.e. not written by a Colab import), with who entered it and
 * when, so test entries can be told apart from real site data. READ-ONLY.
 *
 *   DATABASE_URL="postgresql://..." PROJECT_NAME="Amanvana" \
 *   npx tsx scripts/list-siddhi-entered-records.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const projectName = process.env.PROJECT_NAME ?? "Amanvana";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const isColabKey = (k: string | null) => !!k && k.startsWith("colab");
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace("T", " ");
const day = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const project = await prisma.project.findFirst({ where: { name: projectName }, select: { id: true, name: true } });
  if (!project) { console.error(`Project not found: "${projectName}"`); process.exit(1); }
  console.log(`Project: ${project.name}\n`);

  const progress = await prisma.progressEntry.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "asc" },
    select: {
      displayId: true, date: true, status: true, deletedAt: true, idempotencyKey: true, createdAt: true,
      achievedQuantity: true, cumulativeQuantity: true, notes: true,
      createdBy: { select: { username: true, name: true } },
      wbsNode: {
        select: {
          name: true, totalQuantity: true, unit: true, percentComplete: true,
          villaMilestone: { select: { villa: { select: { number: true } }, section: { select: { name: true } } } },
        },
      },
      _count: { select: { photos: true } },
    },
  });
  const nativeProgress = progress.filter((p) => !isColabKey(p.idempotencyKey));
  console.log(`=== Progress entries entered in Siddhi: ${nativeProgress.length} (incl. drafts/deleted) ===`);
  for (const p of nativeProgress) {
    const vm = p.wbsNode.villaMilestone;
    console.log(
      `  ${p.displayId ?? "-"}  for ${day(p.date)}  entered ${ist(p.createdAt)} IST by ${p.createdBy.username} (${p.createdBy.name})` +
      `${p.status !== "PUBLISHED" ? `  [${p.status}]` : ""}${p.deletedAt ? "  [DELETED]" : ""}`,
    );
    console.log(
      `      ${vm ? `Villa ${vm.villa.number} · ${vm.section.name} · ` : ""}${p.wbsNode.name}` +
      `  · today ${p.achievedQuantity} / cumulative ${p.cumulativeQuantity}${p.wbsNode.totalQuantity ? ` of ${p.wbsNode.totalQuantity} ${p.wbsNode.unit ?? ""}` : ""}` +
      `  · activity now ${p.wbsNode.percentComplete.toFixed(1)}%  · photos ${p._count.photos}` +
      `${p.notes ? `  · notes "${p.notes.slice(0, 80)}"` : ""}`,
    );
  }

  const manpower = await prisma.manpowerEntry.findMany({
    where: { projectId: project.id },
    orderBy: [{ entryDate: "asc" }, { trade: "asc" }],
    select: {
      entryDate: true, trade: true, actualCount: true, notes: true, deletedAt: true, idempotencyKey: true, createdAt: true,
      createdBy: { select: { username: true, name: true } },
      contractor: { select: { name: true } },
    },
  });
  const nativeManpower = manpower.filter((m) => !isColabKey(m.idempotencyKey));
  console.log(`\n=== Manpower entries entered in Siddhi: ${nativeManpower.length} ===`);
  for (const m of nativeManpower) {
    console.log(
      `  ${day(m.entryDate)}  ${m.contractor.name.padEnd(22)} ${m.trade.padEnd(18)} ${String(m.actualCount).padStart(3)}` +
      `  entered ${ist(m.createdAt)} IST by ${m.createdBy.username}${m.deletedAt ? "  [DELETED]" : ""}${m.notes ? `  · "${m.notes.slice(0, 60)}"` : ""}`,
    );
  }
  console.log("\nRead-only — nothing written.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
