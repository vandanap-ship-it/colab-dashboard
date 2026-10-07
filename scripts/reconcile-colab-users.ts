/**
 * Colab users-master → Siddhi users reconciliation. READ-ONLY.
 *
 *   DATABASE_URL="postgresql://..." \
 *   USERS_CSV="~/Downloads/Colab tools report - oct 7th/2026-10-07 05_05_14.938+00_00_e04da8d2-4587-433d-a4ce-03510a6809dc.csv" \
 *   npx tsx scripts/reconcile-colab-users.ts
 *
 * Siddhi accounts were set up from Shraddha's user matrix
 * (scripts/user-matrix-sync.ts) and carry role + module access that Colab
 * doesn't have, so this never creates or edits accounts — it reports, per
 * Colab user, the matching Siddhi account (by email, else by name) and
 * where name / designation / email / active differ. Account changes are a
 * per-person decision.
 *
 * Prints no phone numbers, birth dates or email addresses — only whether
 * the email matches.
 */

import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const csvPath = (process.env.USERS_CSV ?? "").replace(/^~/, process.env.HOME ?? "~");
if (!csvPath || !existsSync(csvPath)) {
  console.error("USERS_CSV env var required + must exist");
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

function parseCsv(text: string): Array<Record<string, string>> {
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; continue; }
      if (ch === '"') { inQuotes = false; continue; }
      field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { cur.push(field); field = ""; continue; }
    if (ch === "\n") { cur.push(field); lines.push(cur); cur = []; field = ""; continue; }
    if (ch === "\r") continue;
    field += ch;
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); lines.push(cur); }
  const header = lines.shift()!.map((h) => h.replace(/^﻿/, "").trim());
  return lines
    .filter((l) => l.some((f) => f.trim()))
    .map((l) => Object.fromEntries(header.map((h, i) => [h, (l[i] ?? "").trim()])));
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

async function main() {
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  const users = await prisma.user.findMany({
    select: {
      id: true, username: true, name: true, email: true, role: true, designation: true, active: true,
      contractor: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });
  const byEmail = new Map(users.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u]));
  const matched = new Set<string>();

  console.log(`Colab users: ${rows.length} · Siddhi users: ${users.length} (${users.filter((u) => u.active).length} active)\n`);
  for (const r of rows) {
    const colabName = `${r.First_Name} ${r.Last_Name}`.trim();
    const email = r.Email_ID?.toLowerCase();
    let u = email ? byEmail.get(email) : undefined;
    let how = u ? "email" : "";
    if (!u) {
      // Exact full name, then same first name + same surname initial.
      const n = norm(colabName);
      const [first, ...rest] = n.split(" ");
      const lastInitial = rest.join(" ").charAt(0);
      const candidates = users.filter((x) => norm(x.name) === n);
      const loose = candidates.length ? candidates : users.filter((x) => {
        const [xf, ...xr] = norm(x.name).split(" ");
        return xf === first && (!lastInitial || xr.join(" ").charAt(0) === lastInitial);
      });
      if (loose.length === 1) { u = loose[0]; how = candidates.length ? "name" : "name (loose)"; }
      else if (loose.length > 1) how = `AMBIGUOUS: ${loose.map((x) => x.username).join(", ")}`;
    }
    const head = `${r.User_ID.padEnd(22)} ${colabName.padEnd(28)} ${(r.Designation || "-").slice(0, 32).padEnd(32)}`;
    if (!u) {
      console.log(`  ✗ ${head} → NOT IN SIDDHI${how ? ` (${how})` : ""}  [${r.User_Type}, ${r.Department || "-"}${r.Agency_Company_Name ? `, agency ${r.Agency_Company_Name}` : ""}]`);
      continue;
    }
    matched.add(u.id);
    const diffs: string[] = [];
    if (norm(u.name) !== norm(colabName)) diffs.push(`name "${u.name}"`);
    if (norm(u.designation) !== norm(r.Designation)) diffs.push(`designation "${u.designation ?? "-"}"`);
    if (email && how !== "email") diffs.push(u.email ? "email differs" : "no email in Siddhi");
    if (!u.active) diffs.push("INACTIVE in Siddhi");
    console.log(`  ✓ ${head} → ${u.username} (${u.role}${u.contractor ? `, ${u.contractor.name}` : ""}) via ${how}${diffs.length ? ` · differs: ${diffs.join("; ")}` : ""}`);
  }

  const siddhiOnly = users.filter((u) => !matched.has(u.id));
  console.log(`\nSiddhi users with no Colab match: ${siddhiOnly.length}`);
  for (const u of siddhiOnly) {
    console.log(`  ${u.username.padEnd(22)} ${u.name.padEnd(28)} ${u.role}${u.active ? "" : " (inactive)"}${u.contractor ? ` · ${u.contractor.name}` : ""}`);
  }
  console.log("\nRead-only — nothing written.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
