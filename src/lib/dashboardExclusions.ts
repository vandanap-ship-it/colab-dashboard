// Dashboard aggregation rules added 2026-11-04 (Vandana management review).
//
// Two concerns:
//
//   1. Test-user noise. The admin / developer account (Vandana) tests a lot,
//      and her submissions were showing up on the QA/QC and EHS tabs as if
//      she were site team. Management shouldn't see that.
//
//   2. QA/QC team vs Safety team mislabelling. The Colab import landed every
//      inspection as module="SAFETY", but Nagarjuna + Thangamani are the
//      QA/QC team on Amanvana (per roles_by_module memory). Inspections they
//      filled belong on the QA/QC tab, not EHS.
//
// Both rules are name-prefix driven so they survive casing / spelling
// variants in the DB. Reclassification happens in the server aggregators;
// the UI doesn't need to know.

/** Users whose submissions are hidden from the production dashboard tabs
 *  (counts + lists). They can still use the app; their rows just don't
 *  pollute the management view. */
export const DASHBOARD_TEST_USER_PREFIXES: readonly string[] = ["Vandana"];

/** Members of the QA/QC team on Amanvana. Inspections they filled count
 *  under QA/QC even if the row's module tag is SAFETY. */
export const QAQC_TEAM_NAME_PREFIXES: readonly string[] = ["Nagarjuna", "Thangamani"];

export function isTestUserName(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return DASHBOARD_TEST_USER_PREFIXES.some((p) => lower.startsWith(p.toLowerCase()));
}

export function isQaqcTeamName(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return QAQC_TEAM_NAME_PREFIXES.some((p) => lower.startsWith(p.toLowerCase()));
}
