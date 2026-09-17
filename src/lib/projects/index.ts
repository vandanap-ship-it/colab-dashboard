/**
 * Project-override registry.
 *
 * Every project-specific rule that used to live inline in shared code
 * (executive rollups, weekly report, scorecard §04 attribution) registers
 * a `ProjectOverride` here. Consumers ask the registry which project
 * matches a given context — a set of block codes, a project name, etc. —
 * and read the overrides from whichever entry answers.
 *
 * Add a new project by dropping `src/lib/projects/<name>.ts` next to
 * `amanvana.ts` and appending its override to the `registry` array below.
 * Shared code paths keep no `if (isAmanvana)` branches.
 */

import { amanvanaProjectOverride } from "./amanvana";

export interface ProjectOverride {
  /** Human-readable name — shown in comments / diagnostics only. */
  name: string;
  /** True when the passed block codes look like this project. */
  detectFromBlockShape: (blockCodes: string[]) => boolean;
  /** Primary contractor's contracted villa + block count (null when the
   *  registry has no explicit number and callers should fall back to
   *  the DB-row count). */
  abrahamScopeOverride: () => { villaCount: number; blockCount: number } | null;
  /** Secondary contractor's contracted villa + block count. */
  elegantScopeOverride: () => { villaCount: number; blockCount: number } | null;
}

const registry: ProjectOverride[] = [amanvanaProjectOverride];

/** Resolve the project override for a given block set. Returns null when
 *  nothing in the registry matches — callers should treat that as "no
 *  project-specific facts", not an error. */
export function getProjectOverride(context: { blockCodes: string[] }): ProjectOverride | null {
  return registry.find((p) => p.detectFromBlockShape(context.blockCodes)) ?? null;
}

/** For tests: the raw registry so tests can assert we haven't accidentally
 *  registered the same project twice or dropped one entirely. */
export function _registeredProjectsForTest(): ProjectOverride[] {
  return [...registry];
}
