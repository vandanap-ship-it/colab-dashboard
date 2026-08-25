import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Audit log helper. Call from every mutation route after the change has been
 * persisted. Designed to be fire-and-forget — if the audit insert fails for
 * any reason we log but never throw, because losing an audit row should never
 * cause a real user-facing operation to fail.
 *
 * Usage:
 *   await recordAudit({
 *     projectId,
 *     userId: session.user.id,
 *     action: "CREATE",
 *     entityType: "Issue",
 *     entityId: issue.id,
 *     summary: `Snag raised against ${activityName}`,
 *   });
 *
 * To run inside an existing transaction, pass `tx`:
 *   await prisma.$transaction(async (tx) => {
 *     ...
 *     await recordAudit({ ..., tx });
 *   });
 */

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "RESTORE"
  | "STATUS_CHANGE"
  | "UPSERT";

export type AuditEntityType =
  | "ProgressEntry"
  | "Issue"
  | "Hindrance"
  | "Concern"
  | "Inspection"
  | "Project"
  | "User"
  | "Contractor"
  | "WBSNode"
  | "SubContractorBill"
  | "Expense"
  | "DesignDrawing"
  | "Rfi"
  | "Permit"
  | "TradePlan"
  | "ManpowerEntry";

export type AuditInput = {
  projectId?: string | null;
  userId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  summary?: string | null;
  changes?: Record<string, unknown> | null;
  tx?: Prisma.TransactionClient;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  const client = input.tx ?? prisma;
  try {
    await client.auditLog.create({
      data: {
        projectId: input.projectId ?? null,
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: input.summary ?? null,
        changes: input.changes ? JSON.stringify(input.changes) : null,
      },
    });
  } catch (e) {
    // Never let an audit failure break a user-facing mutation.
    console.error("[audit] failed to record:", {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Summarise a diff between before and after states. Returns a short list of
 * changed fields like ["status: OPEN -> RESOLVED", "assignedToId: null -> u_123"].
 * Skips fields we don't audit (timestamps, primary keys, etc.).
 */
export function diffSummary(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ignoreFields: string[] = ["id", "createdAt", "updatedAt"],
): { summary: string; changes: Record<string, [unknown, unknown]> } {
  const changes: Record<string, [unknown, unknown]> = {};
  const parts: string[] = [];
  const ignore = new Set(ignoreFields);

  for (const key of Object.keys(after)) {
    if (ignore.has(key)) continue;
    const b = before[key];
    const a = after[key];
    // Shallow compare. For Date objects, compare ISO.
    const bn = b instanceof Date ? b.toISOString() : b;
    const an = a instanceof Date ? a.toISOString() : a;
    if (bn === an) continue;
    if (JSON.stringify(bn) === JSON.stringify(an)) continue;
    changes[key] = [b ?? null, a ?? null];
    parts.push(`${key}: ${fmtVal(b)} -> ${fmtVal(a)}`);
  }

  return {
    summary: parts.slice(0, 4).join(", "),
    changes,
  };
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") return v.length > 30 ? `${v.slice(0, 30)}…` : v;
  return JSON.stringify(v);
}
