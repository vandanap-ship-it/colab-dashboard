/**
 * Precheck-Required gate registry for progress entries.
 *
 * Some activities on a villa cannot be started until an earlier activity's
 * inspection has passed. This is standard construction PM practice — you
 * don't pour concrete until Rebar checklist is signed off, you don't
 * plaster until MEP rough-in has been inspected, etc.
 *
 * The registry below is a set of industry-standard defaults for villa
 * construction. Each rule is anchored by name-regex (case-insensitive,
 * matches on the activity's `WBSNode.name`); the matcher intentionally
 * over-covers with synonyms because our WBS names come from Colab CSVs
 * that use inconsistent wording across sections ("Concreting" vs "RCC
 * casting" vs "Pouring").
 *
 * When an engineer picks an activity, {@link checkPrecheck} walks the
 * same villa (`WBSNode.villaId`) looking for the prerequisite match and
 * verifies at least one Inspection tagged to that WBS row is PASSED.
 * Rejected or in-review inspections are not enough — an engineer who has
 * to close-then-reopen a checklist should not be able to start the next
 * activity in the meantime.
 *
 * The gate is advisory on the *creation* of the WBS row itself — the
 * engineer will always be *able* to fill in a hindrance or a manpower
 * entry against a gated activity. It only blocks *progress logging*.
 */

import { prisma } from "@/lib/prisma";

export type ProgressGateResult =
  | { ok: true }
  | { ok: false; reason: string; requiredActivityName: string; requiredWbsNodeId: string | null };

type GateRule = {
  code: string;
  /** Activity being logged — case-insensitive regex on `WBSNode.name`. */
  activityMatch: RegExp;
  /** Prerequisite activity on the same villa — case-insensitive regex. */
  prerequisiteMatch: RegExp;
  /** Short, human-readable requirement label for the banner. */
  requirement: string;
};

export const PROGRESS_GATES: readonly GateRule[] = [
  {
    code: "rebar-before-concreting",
    // "Concreting", "RCC casting", "Pouring", "Concrete pour"
    activityMatch: /\b(concret(ing|e\s+pour(ing)?)|rcc\s+cast(ing)?|pour(ing)?)\b/i,
    // "Rebar", "Reinforcement", "Steel binding"
    prerequisiteMatch: /\b(rebar|reinforcement|steel\s+bind(ing)?)\b/i,
    requirement: "Rebar / reinforcement checklist",
  },
  {
    code: "shuttering-before-rebar",
    activityMatch: /\b(rebar|reinforcement|steel\s+bind(ing)?)\b/i,
    prerequisiteMatch: /\b(shutt(er|ering)|formwork|centering)\b/i,
    requirement: "Shuttering / formwork checklist",
  },
  {
    code: "waterproofing-before-flooring",
    // "Flooring", "Floor tiling", "Screed", "Screeding"
    activityMatch: /\b(floor(ing|\s+til(e|ing))?|screed(ing)?)\b/i,
    prerequisiteMatch: /\bwaterproof(ing)?\b/i,
    requirement: "Waterproofing checklist",
  },
  {
    code: "mep-rough-in-before-plastering",
    // Plastering, wall closure
    activityMatch: /\b(plaster(ing)?|wall\s+clos(ure|ing))\b/i,
    // Either plumbing OR electrical rough-in on the same villa.
    prerequisiteMatch: /\b((plumb(ing)?|electrical|mep)\s*(rough(-|\s*)in)?)\b/i,
    requirement: "MEP rough-in checklist (plumbing / electrical)",
  },
  {
    code: "plastering-before-painting",
    activityMatch: /\bpaint(ing)?\b/i,
    prerequisiteMatch: /\bplaster(ing)?\b/i,
    requirement: "Plastering checklist",
  },
] as const;

/**
 * Match every gate rule whose `activityMatch` fires on the given activity
 * name. Multiple gates can apply to one activity (a plastering row is
 * gated on both MEP rough-in AND is a prerequisite for painting) — the
 * matcher returns them all so the caller can require every prerequisite
 * to pass.
 */
export function gatesForActivity(activityName: string): readonly GateRule[] {
  return PROGRESS_GATES.filter((g) => g.activityMatch.test(activityName));
}

/**
 * Server-side precheck. Given the WBSNode the engineer is trying to log
 * progress against, verifies that every applicable gate's prerequisite
 * has at least one PASSED inspection on the *same villa*. Returns a
 * refusal on the first missing prerequisite so the UX message is
 * specific ("Rebar checklist must pass on this villa first") rather
 * than a generic "prerequisites not met".
 *
 * Villa isolation is enforced via `WBSNode.villaId`. Two activities that
 * are not tagged to the same villaId are never each other's
 * prerequisites — otherwise Villa 12 rebar could gate Villa 30 concreting,
 * which is not what construction sequencing means.
 *
 * Nodes without a `villaId` (structural / parent rows) fall through as
 * `{ ok: true }`. Those aren't the leaf activities the mobile form ever
 * targets, but the guard keeps the API safe for direct callers.
 */
export async function checkPrecheck(wbsNodeId: string): Promise<ProgressGateResult> {
  const target = await prisma.wBSNode.findUnique({
    where: { id: wbsNodeId },
    select: { id: true, name: true, projectId: true, villaId: true },
  });
  if (!target) return { ok: true }; // let the caller's own FK guard fail on a bad id

  const applicable = gatesForActivity(target.name);
  if (applicable.length === 0) return { ok: true };

  // No villa tag means we can't meaningfully search "same villa" for the
  // prerequisite — skip the gate rather than block on ambiguity.
  if (!target.villaId) return { ok: true };

  // Pull every activity on this villa once; each gate walks the same
  // in-memory list. Villa rowcount on Amanvana is bounded (< 300 nodes
  // per villa) so a single query stays fast.
  const villaActivities = await prisma.wBSNode.findMany({
    where: { projectId: target.projectId, villaId: target.villaId },
    select: { id: true, name: true },
  });

  for (const gate of applicable) {
    const prereqNodes = villaActivities.filter((n) => gate.prerequisiteMatch.test(n.name));
    if (prereqNodes.length === 0) {
      // The villa's WBS has no matching prerequisite row — the gate
      // doesn't apply here (e.g. an activity named "Concreting" on a
      // section that skipped rebar sub-tasks). Skip.
      continue;
    }

    // Passed inspections tagged to any of the prerequisite rows.
    const passedCount = await prisma.inspection.count({
      where: {
        projectId: target.projectId,
        wbsNodeId: { in: prereqNodes.map((n) => n.id) },
        status: "PASSED",
        deletedAt: null,
      },
    });
    if (passedCount === 0) {
      return {
        ok: false,
        reason: `${gate.requirement} must be passed on this villa before you can log progress on ${target.name}.`,
        requiredActivityName: gate.requirement,
        requiredWbsNodeId: prereqNodes[0]?.id ?? null,
      };
    }
  }

  return { ok: true };
}
