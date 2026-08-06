// ---------------------------------------------------------------------------
// RFI helpers — pure logic (validation + status transitions + label helpers).
// Prisma-free so it stays unit-testable.
// ---------------------------------------------------------------------------

export const RFI_STATUSES = ["OPEN", "ANSWERED", "CLOSED"] as const;
export type RfiStatus = (typeof RFI_STATUSES)[number];

export const RFI_CATEGORIES = [
  "STRUCTURAL",
  "MEP",
  "ARCHITECTURAL",
  "FINISHING",
  "OTHER",
] as const;
export type RfiCategory = (typeof RFI_CATEGORIES)[number];

export const RFI_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type RfiPriority = (typeof RFI_PRIORITIES)[number];

export const RFI_STATUS_LABELS: Record<RfiStatus, string> = {
  OPEN: "Open",
  ANSWERED: "Answered",
  CLOSED: "Closed",
};

export const RFI_CATEGORY_LABELS: Record<RfiCategory, string> = {
  STRUCTURAL: "Structural",
  MEP: "MEP",
  ARCHITECTURAL: "Architectural",
  FINISHING: "Finishing",
  OTHER: "Other",
};

export const RFI_PRIORITY_LABELS: Record<RfiPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

/** Legal status transitions. Anything not in this map is rejected. */
const TRANSITIONS: Record<RfiStatus, RfiStatus[]> = {
  OPEN: ["ANSWERED", "CLOSED"],   // can answer, or close without answer
  ANSWERED: ["CLOSED", "OPEN"],   // can close, or reopen for follow-up
  CLOSED: ["OPEN"],               // reopen only
};

export function canTransition(from: RfiStatus, to: RfiStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Format the auto-numbered RFI: RFI-0001, RFI-0012, RFI-1234. */
export function formatRfiNumber(n: number): string {
  return `RFI-${String(n).padStart(4, "0")}`;
}

/** Compute the next number for a project — findFirst desc + 1.
 *  Typed loosely so both the real Prisma client and a test double satisfy it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function nextRfiNumber(client: any, projectId: string): Promise<number> {
  const latest = await client.rfi.findFirst({
    where: { projectId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return (latest?.number ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export interface CreateRfiInput {
  subject: string;
  description: string;
  category: RfiCategory;
  priority?: RfiPriority;
  assignedToId?: string | null;
  wbsNodeId?: string | null;
  dueDate?: string | null; // ISO date string
}

export interface ValidationError {
  field: keyof CreateRfiInput | "answer" | "status";
  message: string;
}

export function validateCreateRfi(input: Partial<CreateRfiInput>): ValidationError[] {
  const errs: ValidationError[] = [];
  const subject = (input.subject ?? "").trim();
  const description = (input.description ?? "").trim();
  if (!subject) errs.push({ field: "subject", message: "Subject is required." });
  if (subject.length > 200) errs.push({ field: "subject", message: "Subject must be under 200 characters." });
  if (!description) errs.push({ field: "description", message: "Description is required." });
  if (description.length > 4000) errs.push({ field: "description", message: "Description must be under 4000 characters." });
  if (!input.category || !RFI_CATEGORIES.includes(input.category)) {
    errs.push({ field: "category", message: "Category is required." });
  }
  if (input.priority && !RFI_PRIORITIES.includes(input.priority)) {
    errs.push({ field: "priority", message: "Priority must be LOW, MEDIUM, or HIGH." });
  }
  if (input.dueDate) {
    const d = new Date(input.dueDate);
    if (isNaN(d.getTime())) errs.push({ field: "dueDate", message: "Due date is not a valid date." });
  }
  return errs;
}

export function validateAnswer(answer: string): ValidationError[] {
  const errs: ValidationError[] = [];
  const trimmed = answer.trim();
  if (!trimmed) errs.push({ field: "answer", message: "Answer text is required." });
  if (trimmed.length > 4000) errs.push({ field: "answer", message: "Answer must be under 4000 characters." });
  return errs;
}
