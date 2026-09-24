// ---------------------------------------------------------------------------
// Email dispatch — thin Resend HTTP wrapper.
//
// Kept dependency-free (fetch to Resend's REST API) so we don't add another
// package to the deploy. If RESEND_API_KEY is missing we log and no-op — the
// app keeps working, just without email notifications.
//
// Sender must be a verified domain in Resend (whitelotusgroup.in). Add the
// domain in Resend dashboard → Domains before flipping the API key on.
// ---------------------------------------------------------------------------

import "server-only";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "Siddhi <noreply@whitelotusgroup.in>";

// Fixed "15 Sep 2026" formatter — deterministic across Node versions & locales.
// Node's Intl.DateTimeFormat("en-GB") switched September's abbreviation from
// "Sep" to "Sept" in some versions; that breaks assertion snapshots and reads
// oddly to Indian users. Hand-rolled to keep it stable.
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${day} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Product-owner-provided recipient list for milestone-completion + overdue digests.
export const DEFAULT_RECIPIENTS = [
  "vandana.p@whitelotusgroup.in",
  "shraddha.b@whitelotusgroup.in",
];

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string | string[];
}

export interface EmailResult {
  ok: boolean;
  id?: string;
  error?: string;
  /** True when RESEND_API_KEY is missing — helps callers log "no-op" gracefully. */
  skipped?: boolean;
}

/**
 * Dispatch one email via Resend. Returns a result — NEVER throws — so callers
 * inside API routes or Prisma middleware can safely await without swallowing
 * unrelated errors.
 */
export async function sendEmail(input: SendEmailInput): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.info(`[email] RESEND_API_KEY not set — skipping "${input.subject}" to ${input.to}`);
    return { ok: true, skipped: true };
  }

  const body = {
    from: input.from ?? DEFAULT_FROM,
    to: Array.isArray(input.to) ? input.to : [input.to],
    subject: input.subject,
    html: input.html,
    ...(input.text && { text: input.text }),
    ...(input.replyTo && {
      reply_to: Array.isArray(input.replyTo) ? input.replyTo : [input.replyTo],
    }),
  };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[email] Resend responded ${res.status}: ${errText}`);
      return { ok: false, error: `HTTP ${res.status}: ${errText}` };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, id: json.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[email] dispatch failed: ${msg}`);
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Shared template shell — brand-consistent HTML wrapper.
// Kept inline (no separate template file yet) so the whole email surface is
// grep-able and diff-able. Refactor to files if we grow past ~5 flows.
// ---------------------------------------------------------------------------

const BRAND_NAVY = "#16202F";
const BRAND_AMBER = "#F59E0B";
const INK = "#1B2432";
const INK_2 = "#4E5866";
const RULE = "#E2DDD0";

/** Wrap a body block in the Siddhi email chrome. */
export function shell(opts: {
  preheader: string;
  headline: string;
  bodyHtml: string;
  cta?: { text: string; url: string };
  footer?: string;
}): string {
  const cta = opts.cta
    ? `<p style="margin: 24px 0 8px;">
         <a href="${opts.cta.url}"
            style="display:inline-block; background:${BRAND_NAVY}; color:#fff;
                   padding: 12px 22px; border-radius: 6px; text-decoration:none;
                   font-weight:600; letter-spacing:0.02em;">
           ${opts.cta.text}
         </a>
       </p>`
    : "";

  const footer =
    opts.footer ??
    `Automated message from Siddhi — the White Lotus construction dashboard.<br>
     If this reached you in error, reply to this thread and we'll adjust the recipient list.`;

  return `<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#F7F5EF; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:${INK};">
    <span style="display:none; font-size:0; color:transparent; visibility:hidden; opacity:0; height:0; width:0; overflow:hidden;">
      ${opts.preheader}
    </span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F7F5EF;">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0"
               style="background:#fff; border:1px solid ${RULE}; border-radius:10px;
                      max-width:560px; box-shadow: 0 1px 3px rgba(22,32,47,0.06);">
          <tr><td style="padding: 22px 26px 6px; border-bottom: 1px solid ${RULE};">
            <div style="font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:${INK_2}; font-weight:600;">
              SIDDHI · WHITE LOTUS
            </div>
            <h1 style="margin: 6px 0 0; font-size: 20px; letter-spacing:-0.01em; color:${INK}; font-weight:600;">
              ${opts.headline}
            </h1>
          </td></tr>
          <tr><td style="padding: 20px 26px; font-size: 14px; line-height: 1.55; color:${INK};">
            ${opts.bodyHtml}
            ${cta}
          </td></tr>
          <tr><td style="padding: 14px 26px 20px; border-top: 1px solid ${RULE};
                          font-size: 11.5px; color:${INK_2}; line-height:1.5;">
            ${footer}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

// ---------------------------------------------------------------------------
// Flow 1 — Task/Concern/Issue assignment
// ---------------------------------------------------------------------------

export interface AssignmentEmailInput {
  to: string;
  assigneeName: string;
  itemType: "Concern" | "Issue" | "Task" | "Work Permit";
  itemTitle: string;
  itemUrl: string;
  raisedByName?: string;
  dueDate?: Date | null;
}

export function assignmentEmail(input: AssignmentEmailInput): SendEmailInput {
  const dueLine = input.dueDate
    ? `<p><strong>Due:</strong> ${fmtDate(input.dueDate)}</p>`
    : "";
  const raisedByLine = input.raisedByName
    ? `<p style="color:${INK_2};">Raised by <strong>${input.raisedByName}</strong>.</p>`
    : "";
  return {
    to: input.to,
    subject: `[Siddhi] ${input.itemType} assigned: ${input.itemTitle}`,
    html: shell({
      preheader: `A ${input.itemType.toLowerCase()} has been assigned to you.`,
      headline: `${input.itemType} assigned to you`,
      bodyHtml: `
        <p>Hi ${input.assigneeName},</p>
        <p>You have a new ${input.itemType.toLowerCase()} to action:</p>
        <p style="padding: 12px 14px; background: #F7F5EF; border-radius: 6px;
                  border-left: 3px solid ${BRAND_AMBER};">
          <strong>${input.itemTitle}</strong>
        </p>
        ${dueLine}
        ${raisedByLine}
      `,
      cta: { text: `Open ${input.itemType.toLowerCase()}`, url: input.itemUrl },
    }),
  };
}

// ---------------------------------------------------------------------------
// Flow 1b — Work permit decision (goes back to the requester)
// ---------------------------------------------------------------------------

export interface WorkPermitDecisionInput {
  to: string;
  requesterName: string;
  permitTitle: string;
  permitTypeLabel: string;
  workDate: string; // pre-formatted (from formatDayMonthYear)
  decision: "APPROVED" | "REJECTED";
  actorName: string; // approver / rejecter
  rejectionReason?: string;
  permitUrl: string;
}

/**
 * Fires when an approver acts on a permit — either approved or rejected.
 * The requester is the person who raised the permit and needs to know
 * whether they can start the work. Kept separate from assignmentEmail
 * because the framing is different (this is a DECISION not a NEW ITEM).
 */
export function workPermitDecisionEmail(input: WorkPermitDecisionInput): SendEmailInput {
  const isApproved = input.decision === "APPROVED";
  const chipBg = isApproved ? "#E4EFE8" : "#F3DFDF";
  const chipFg = isApproved ? "#2E7D5B" : "#B33A3A";
  const chipLabel = isApproved ? "Approved" : "Rejected";
  const reasonBlock =
    !isApproved && input.rejectionReason
      ? `<p style="padding: 12px 14px; background: #F3DFDF; border-radius: 6px;
                   border-left: 3px solid ${chipFg}; color: #6B1F1F;">
          <strong>Reason:</strong> ${input.rejectionReason}
        </p>`
      : "";
  return {
    to: input.to,
    subject: `[Siddhi] Work Permit ${chipLabel}: ${input.permitTitle}`,
    html: shell({
      preheader: `Your work permit was ${chipLabel.toLowerCase()} by ${input.actorName}.`,
      headline: `Work Permit ${chipLabel}`,
      bodyHtml: `
        <p>Hi ${input.requesterName},</p>
        <p>
          <span style="display: inline-block; padding: 2px 10px; background: ${chipBg};
                       color: ${chipFg}; border-radius: 999px; font-weight: 600;
                       font-size: 12px; letter-spacing: .5px; text-transform: uppercase;">
            ${chipLabel}
          </span>
        </p>
        <p style="padding: 12px 14px; background: #F7F5EF; border-radius: 6px;
                  border-left: 3px solid ${BRAND_AMBER};">
          <strong>${input.permitTypeLabel} — ${input.permitTitle}</strong><br>
          <span style="color: ${INK_2};">Work date: ${input.workDate}</span>
        </p>
        ${reasonBlock}
        <p style="color: ${INK_2};">
          ${isApproved ? "Approved" : "Rejected"} by <strong>${input.actorName}</strong>.
        </p>
      `,
      cta: { text: "Open permit", url: input.permitUrl },
    }),
  };
}

// ---------------------------------------------------------------------------
// Flow 2 — Milestone completion (auto-email to fixed recipients)
// ---------------------------------------------------------------------------

export interface MilestoneCompletionInput {
  to?: string[];              // defaults to DEFAULT_RECIPIENTS
  projectName: string;
  villaLabel: string;         // "Villa 12" or "Villa 10 & 11"
  sectionName: string;        // "Foundation / Substructure"
  actualFinish: Date;
  baselineFinish: Date | null;
  dashboardUrl: string;
}

export function milestoneCompletionEmail(input: MilestoneCompletionInput): SendEmailInput {
  const slipDays =
    input.baselineFinish
      ? Math.round((input.actualFinish.getTime() - input.baselineFinish.getTime()) / 86_400_000)
      : null;
  const slipChip =
    slipDays == null ? ""
      : slipDays <= 0
        ? `<span style="display:inline-block; background:#E4EFE8; color:#2E7D5B; padding:2px 8px; border-radius:3px; font-weight:600; font-size:11.5px;">ON-TIME</span>`
        : `<span style="display:inline-block; background:#F3DFDF; color:#B33A3A; padding:2px 8px; border-radius:3px; font-weight:600; font-size:11.5px;">${slipDays}d LATE</span>`;

  const fmt = fmtDate;

  return {
    to: input.to ?? DEFAULT_RECIPIENTS,
    subject: `[Siddhi] ${input.villaLabel} · ${input.sectionName} completed`,
    html: shell({
      preheader: `${input.villaLabel} finished ${input.sectionName}`,
      headline: `Milestone completed`,
      bodyHtml: `
        <p><strong>${input.projectName}</strong></p>
        <table role="presentation" cellpadding="6" cellspacing="0"
               style="border-collapse: collapse; margin: 8px 0 14px; font-size: 13.5px;">
          <tr><td style="color:${INK_2}; padding-right:12px;">Villa</td>
              <td><strong>${input.villaLabel}</strong></td></tr>
          <tr><td style="color:${INK_2}; padding-right:12px;">Milestone</td>
              <td><strong>${input.sectionName}</strong></td></tr>
          <tr><td style="color:${INK_2}; padding-right:12px;">Actual finish</td>
              <td><strong>${fmt(input.actualFinish)}</strong> ${slipChip}</td></tr>
          ${input.baselineFinish
            ? `<tr><td style="color:${INK_2}; padding-right:12px;">Baseline finish</td>
                   <td>${fmt(input.baselineFinish)}</td></tr>`
            : ""}
        </table>
      `,
      cta: { text: "Open dashboard", url: input.dashboardUrl },
    }),
  };
}

// ---------------------------------------------------------------------------
// Flow 3 — Overdue-baseline nightly digest
// ---------------------------------------------------------------------------

export interface OverdueDigestItem {
  villaLabel: string;
  sectionName: string;
  baselineFinish: Date;
  slipDays: number;
  currentPct: number;
}

export interface OverdueDigestInput {
  to?: string[];
  projectName: string;
  dashboardUrl: string;
  items: OverdueDigestItem[];
  asOf: Date;
}

// ---------------------------------------------------------------------------
// Flow 4 — Today's site tasks (morning brief to site engineers)
//
// Fires at 07:00 IST Mon-Sat via /api/cron/daily-tasks. Recipient list is
// scoped narrowly to the two people who actually log site progress for
// White Lotus (Harish + Madhavarajan) — matches the daily push-nudge
// allowlist so nobody gets pinged twice unless they own it.
// ---------------------------------------------------------------------------

export interface DailyTaskItem {
  villaLabel: string;
  blockCode: string | null;
  activityName: string;
  contractorName: string | null;
  baselineFinish: Date | null;
  percentComplete: number;
}

export interface DailyTasksInput {
  to: string[];
  projectName: string;
  dashboardUrl: string;
  items: DailyTaskItem[];
  asOf: Date;
}

export function dailyTasksEmail(input: DailyTasksInput): SendEmailInput | null {
  if (input.items.length === 0) return null;

  const fmt = fmtDate;
  // Group by block, then villa — same shape as the site activity report
  // Shraddha already reads. Keeps the mail scannable when there are 50+
  // rows (whole block worth of work) instead of a flat wall of lines.
  const byBlock = new Map<string, Map<string, DailyTaskItem[]>>();
  for (const it of input.items) {
    const b = it.blockCode ?? "Untagged";
    if (!byBlock.has(b)) byBlock.set(b, new Map());
    const villas = byBlock.get(b)!;
    if (!villas.has(it.villaLabel)) villas.set(it.villaLabel, []);
    villas.get(it.villaLabel)!.push(it);
  }
  const blockOrder = [...byBlock.keys()].sort();

  const blocks = blockOrder
    .map((blockCode) => {
      const villas = byBlock.get(blockCode)!;
      const villaBlocks = [...villas.entries()]
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
        .map(([villaLabel, rows]) => {
          const rowsHtml = rows
            .map(
              (r) => `
                <tr style="border-bottom:1px solid ${RULE};">
                  <td style="padding:6px 8px; color:${INK};"><strong>${r.activityName}</strong></td>
                  <td style="padding:6px 8px; color:${INK_2}; font-size:12px;">${r.contractorName ?? "—"}</td>
                  <td style="padding:6px 8px; color:${INK_2}; font-size:12px; white-space:nowrap; text-align:right;">
                    ${r.baselineFinish ? "ends " + fmt(r.baselineFinish) : "—"}
                  </td>
                  <td style="padding:6px 8px; text-align:right; color:${INK_2}; font-size:12px;">${Math.round(r.percentComplete)}%</td>
                </tr>`,
            )
            .join("");
          return `
            <tr><td colspan="4" style="padding:12px 8px 4px; font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:${INK_2}; font-weight:600;">
              ${villaLabel}
            </td></tr>
            ${rowsHtml}
          `;
        })
        .join("");
      return `
        <p style="margin: 18px 0 4px; font-size: 13.5px; font-weight: 700; color: ${INK};
                  border-bottom: 2px solid ${BRAND_AMBER}; padding-bottom: 4px;">
          Block ${blockCode}
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0"
               style="border-collapse: collapse; width: 100%; font-size: 12.5px;">
          <tbody>${villaBlocks}</tbody>
        </table>
      `;
    })
    .join("");

  const totalVillas = new Set(input.items.map((i) => i.villaLabel)).size;
  const totalBlocks = byBlock.size;

  return {
    to: input.to,
    subject: `[Siddhi] Today's site tasks · ${input.projectName} — ${fmt(input.asOf)}`,
    html: shell({
      preheader: `${input.items.length} activities planned across ${totalVillas} villas today.`,
      headline: `Today's site tasks`,
      bodyHtml: `
        <p><strong>${input.projectName}</strong> · ${fmt(input.asOf)}</p>
        <p style="color:${INK_2}; margin-top: 4px;">
          <strong style="color:${INK};">${input.items.length}</strong> activities planned across
          <strong style="color:${INK};">${totalVillas}</strong> villa${totalVillas === 1 ? "" : "s"} in
          <strong style="color:${INK};">${totalBlocks}</strong> block${totalBlocks === 1 ? "" : "s"}.
          These are the line items in today's schedule window.
        </p>
        ${blocks}
      `,
      cta: { text: "Open dashboard", url: input.dashboardUrl },
      footer: `Automated from Siddhi — sent to Harish and Madhavarajan every weekday morning.<br>
               Reply to this thread if the list looks off, or say "stop" to opt out.`,
    }),
  };
}

// Flow 3 builder — the interfaces above sit next to the shared cron file.
export function overdueDigestEmail(input: OverdueDigestInput): SendEmailInput | null {
  if (input.items.length === 0) return null;  // nothing to send

  const fmt = fmtDate;
  const rows = input.items
    .slice(0, 30)  // cap for reasonable email length; link takes them to full view
    .map(
      (it) => `
        <tr style="border-bottom:1px solid ${RULE};">
          <td style="padding:6px 8px;"><strong>${it.villaLabel}</strong></td>
          <td style="padding:6px 8px; color:${INK_2};">${it.sectionName}</td>
          <td style="padding:6px 8px; color:${INK_2}; white-space:nowrap;">${fmt(it.baselineFinish)}</td>
          <td style="padding:6px 8px; color:#B33A3A; font-weight:700; text-align:right;">+${it.slipDays}d</td>
          <td style="padding:6px 8px; text-align:right; color:${INK_2};">${it.currentPct}%</td>
        </tr>`,
    )
    .join("");
  const more =
    input.items.length > 30
      ? `<p style="color:${INK_2}; font-size:12px; margin-top:8px;">Showing 30 of ${input.items.length}. Open dashboard for the full list.</p>`
      : "";

  return {
    to: input.to ?? DEFAULT_RECIPIENTS,
    subject: `[Siddhi] ${input.items.length} milestone${input.items.length === 1 ? "" : "s"} overdue on ${input.projectName}`,
    html: shell({
      preheader: `${input.items.length} milestones behind baseline as of ${fmt(input.asOf)}.`,
      headline: `${input.items.length} milestone${input.items.length === 1 ? "" : "s"} behind baseline`,
      bodyHtml: `
        <p><strong>${input.projectName}</strong> · as of ${fmt(input.asOf)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0"
               style="border-collapse: collapse; width: 100%; font-size: 12.5px; margin-top: 8px;">
          <thead>
            <tr style="background:#F7F5EF; text-align:left;">
              <th style="padding:6px 8px; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:${INK_2};">Villa</th>
              <th style="padding:6px 8px; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:${INK_2};">Milestone</th>
              <th style="padding:6px 8px; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:${INK_2};">Baseline</th>
              <th style="padding:6px 8px; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:${INK_2}; text-align:right;">Slip</th>
              <th style="padding:6px 8px; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:${INK_2}; text-align:right;">%</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${more}
      `,
      cta: { text: "Open dashboard", url: input.dashboardUrl },
    }),
  };
}

// ---------------------------------------------------------------------------
// Flow 5 — Weekly executive roll-up
//
// Auto-Friday summary of Amanvana (or any project) for White Lotus
// leadership. Meant to answer "should I look at the dashboard this week?"
// in one 30-second glance: overall progress delta, manpower vs plan, top
// three delay reasons. Full detail lives on the desktop weekly report
// page; the email links there through the CTA.
// ---------------------------------------------------------------------------

export interface WeeklyReportEmailInput {
  to: string | string[];
  projectName: string;
  weekEndLabel: string; // pre-formatted "26 Sep 2026"
  plannedPct: number;
  actualPct: number;
  variancePct: number;
  manpowerActual: number;
  manpowerPlanned: number;
  manpowerPctOfPlan: number | null;
  milestones: {
    completed: number;
    started: number;
    notStarted: number;
    overdue: number;
  };
  byContractor: Array<{
    name: string;
    weeklyPlanned: number;
    weeklyActual: number;
    pctOfPlan: number | null;
  }>;
  topDelayReasons: Array<{ label: string; count: number; daysImpact: number }>;
  reportUrl: string;
}

export function weeklyReportEmail(input: WeeklyReportEmailInput): SendEmailInput {
  const varianceSign = input.variancePct > 0 ? "+" : "";
  const varianceTone = input.variancePct >= 0 ? "#059669" : "#B83E22"; // emerald / ferrous
  const manpowerPctText =
    input.manpowerPctOfPlan == null ? "—" : `${Math.round(input.manpowerPctOfPlan * 100)}%`;
  const manpowerTone =
    input.manpowerPctOfPlan == null
      ? INK_2
      : input.manpowerPctOfPlan >= 0.9
        ? "#059669"
        : "#B83E22";

  const headlineHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 4px 0 20px;">
      <tr>
        <td style="width:33.33%; padding: 12px 8px; text-align:center; background:#F7F5EF; border-radius:6px 0 0 6px;">
          <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:${INK_2}; font-weight:600;">
            Actual
          </div>
          <div style="font-size:28px; font-weight:700; color:${INK}; margin-top:4px;">
            ${Math.round(input.actualPct)}%
          </div>
          <div style="font-size:11.5px; color:${INK_2}; margin-top:2px;">
            planned ${Math.round(input.plannedPct)}%
          </div>
        </td>
        <td style="width:33.33%; padding: 12px 8px; text-align:center; background:#F7F5EF; border-left: 1px solid ${RULE}; border-right: 1px solid ${RULE};">
          <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:${INK_2}; font-weight:600;">
            Variance
          </div>
          <div style="font-size:28px; font-weight:700; color:${varianceTone}; margin-top:4px;">
            ${varianceSign}${input.variancePct.toFixed(1)}%
          </div>
          <div style="font-size:11.5px; color:${INK_2}; margin-top:2px;">
            ${input.variancePct >= 0 ? "on / ahead of plan" : "behind plan"}
          </div>
        </td>
        <td style="width:33.33%; padding: 12px 8px; text-align:center; background:#F7F5EF; border-radius:0 6px 6px 0;">
          <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:${INK_2}; font-weight:600;">
            Manpower
          </div>
          <div style="font-size:28px; font-weight:700; color:${manpowerTone}; margin-top:4px;">
            ${manpowerPctText}
          </div>
          <div style="font-size:11.5px; color:${INK_2}; margin-top:2px;">
            ${input.manpowerActual.toLocaleString("en-IN")} / ${input.manpowerPlanned.toLocaleString("en-IN")}
          </div>
        </td>
      </tr>
    </table>
  `;

  const milestonesLine = `
    <p style="margin: 0 0 14px; color:${INK}; font-size:14px;">
      <strong>Milestones:</strong>
      ${input.milestones.completed} completed ·
      ${input.milestones.started} started ·
      <span style="color:${input.milestones.notStarted > 0 ? "#B83E22" : INK_2};">
        ${input.milestones.notStarted} planned but not started
      </span> ·
      <span style="color:${input.milestones.overdue > 0 ? "#B83E22" : INK_2};">
        ${input.milestones.overdue} overdue
      </span>
    </p>
  `;

  const contractorRowsHtml = input.byContractor
    .map((c, idx) => {
      const pctText = c.pctOfPlan == null ? "—" : `${Math.round(c.pctOfPlan * 100)}%`;
      const tone =
        c.pctOfPlan == null ? INK_2 : c.pctOfPlan >= 0.9 ? "#059669" : "#B83E22";
      const bg = idx % 2 === 0 ? "#F7F5EF" : "#fff";
      return `
        <tr>
          <td style="padding: 8px 12px; background:${bg}; font-size:13px; color:${INK};">
            ${c.name}
          </td>
          <td style="padding: 8px 12px; background:${bg}; text-align:right; font-size:13px; color:${INK_2};">
            ${c.weeklyActual.toLocaleString("en-IN")} / ${c.weeklyPlanned.toLocaleString("en-IN")}
          </td>
          <td style="padding: 8px 12px; background:${bg}; text-align:right; font-size:13px; font-weight:600; color:${tone};">
            ${pctText}
          </td>
        </tr>
      `;
    })
    .join("");
  const contractorTableHtml =
    input.byContractor.length > 0
      ? `
        <p style="margin: 14px 0 6px; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${INK_2}; font-weight:600;">
          Manpower by contractor
        </p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid ${RULE}; border-radius:6px; overflow:hidden;">
          ${contractorRowsHtml}
        </table>
      `
      : "";

  const delayReasonsHtml =
    input.topDelayReasons.length > 0
      ? `
        <p style="margin: 20px 0 6px; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${INK_2}; font-weight:600;">
          Top delay reasons
        </p>
        <ul style="margin: 4px 0 0; padding-left: 18px; color:${INK}; font-size:13.5px; line-height:1.55;">
          ${input.topDelayReasons
            .slice(0, 3)
            .map(
              (r) => `
            <li>
              <strong>${r.label}</strong> —
              ${r.count} activit${r.count === 1 ? "y" : "ies"},
              ${r.daysImpact} day${r.daysImpact === 1 ? "" : "s"} lost
            </li>
          `,
            )
            .join("")}
        </ul>
      `
      : `
        <p style="margin: 20px 0 0; color:${INK_2}; font-size:13.5px; font-style:italic;">
          No delay reasons logged this week — clean run.
        </p>
      `;

  const preheader = `Actual ${Math.round(input.actualPct)}% · variance ${varianceSign}${input.variancePct.toFixed(1)}% · manpower ${manpowerPctText}`;

  return {
    to: input.to,
    subject: `[Siddhi] ${input.projectName} · Weekly roll-up · ${input.weekEndLabel}`,
    html: shell({
      preheader,
      headline: `${input.projectName} · week ending ${input.weekEndLabel}`,
      bodyHtml: `
        ${headlineHtml}
        ${milestonesLine}
        ${contractorTableHtml}
        ${delayReasonsHtml}
      `,
      cta: { text: "Open weekly report", url: input.reportUrl },
    }),
  };
}

// ---------------------------------------------------------------------------
// Daily "Waiting on you" email nudge — companion to the mobile home strip.
// Fires each morning to the same recipients who receive the daily-tasks
// email. Only sends when at least one bucket is non-zero — a clean morning
// gets no mail, so people don't tune the alert out.
// ---------------------------------------------------------------------------

export interface WaitingNudgeInput {
  to: string | string[];
  toName?: string;                  // "Hi {name}" opener; falls back to a neutral greeting
  projectName: string;
  asOf: Date;
  buckets: {
    staleWirs: number;              // WIRs IN_REVIEW past the 7d SLA
    stalePermits: number;           // Permits PENDING past the 2d SLA
    staleHindrances: number;        // Hindrances OPEN past the 3d SLA
    staleIssues: number;            // Snags OPEN/IN_REINSPECTION past the 4d SLA
    staleConcerns: number;          // Concerns PENDING past the 5d SLA
    myDrafts: number;               // Filler's own DRAFT WIRs, any age
  };
  homeUrl: string;                  // Deep-link back into the mobile home
}

/**
 * Compact "waiting on you" nudge. Returns null when every bucket is 0 so
 * the caller can skip the send without lighting up an inbox with a
 * "you're clear" note every morning.
 */
export function waitingNudgeEmail(input: WaitingNudgeInput): SendEmailInput | null {
  const { buckets } = input;
  const total =
    buckets.staleWirs +
    buckets.stalePermits +
    buckets.staleHindrances +
    buckets.staleIssues +
    buckets.staleConcerns +
    buckets.myDrafts;
  if (total === 0) return null;

  // Row shape: [count, singular label, plural label, deep-link path].
  // Ordered by escalation strength — permits (blocking) first, drafts
  // (your own work) last. Deep-links preserve the tab / status filter
  // so the tap lands on the exact rows the count is measuring.
  type Row = { n: number; label: string; href: string; stale: boolean };
  const rows: Row[] = [
    { n: buckets.stalePermits, label: buckets.stalePermits === 1 ? "stale permit" : "stale permits", href: "/permit", stale: true },
    { n: buckets.staleHindrances, label: buckets.staleHindrances === 1 ? "stale blocker" : "stale blockers", href: "/hindrance?tab=open", stale: true },
    { n: buckets.staleIssues, label: buckets.staleIssues === 1 ? "stale snag" : "stale snags", href: "/issue?tab=open", stale: true },
    { n: buckets.staleConcerns, label: buckets.staleConcerns === 1 ? "stale concern" : "stale concerns", href: "/concern?tab=pending", stale: true },
    { n: buckets.staleWirs, label: buckets.staleWirs === 1 ? "stale WIR" : "stale WIRs", href: "/qaqc?tab=pending", stale: true },
    { n: buckets.myDrafts, label: buckets.myDrafts === 1 ? "draft to finish" : "drafts to finish", href: "/qaqc?tab=drafts", stale: false },
  ].filter((r) => r.n > 0);

  const homeBase = input.homeUrl.replace(/\/+$/, "");
  const rowsHtml = rows
    .map((r) => {
      const link = `${homeBase}${r.href}`;
      // Muted amber pill for aging/stale rows, neutral for drafts —
      // matches the sandstone vs ferrous split the on-screen strip uses.
      const pillBg = r.stale ? "#F9DEC6" : "#EDE4CE";
      const pillColor = r.stale ? "#96430A" : "#4E5866";
      return `
        <tr>
          <td style="padding:10px 8px; vertical-align:middle;">
            <span style="display:inline-block; min-width:26px; padding:2px 8px;
                         border-radius:999px; background:${pillBg}; color:${pillColor};
                         font-size:12px; font-weight:600; text-align:center;
                         font-variant-numeric: tabular-nums;">${r.n}</span>
          </td>
          <td style="padding:10px 8px; vertical-align:middle; color:${INK}; font-size:14px;">
            <a href="${link}" style="color:${INK}; text-decoration:none;">${r.label}</a>
          </td>
        </tr>`;
    })
    .join("");

  const opener = input.toName ? `Hi ${input.toName.split(" ")[0]},` : "Good morning,";
  const staleCount = rows.filter((r) => r.stale).reduce((n, r) => n + r.n, 0);
  const draftCount = buckets.myDrafts;

  const lede = (() => {
    if (staleCount > 0 && draftCount > 0) {
      return `You have <strong style="color:${INK};">${staleCount}</strong> row${staleCount === 1 ? "" : "s"} past their SLA on ${input.projectName}, plus ${draftCount} draft${draftCount === 1 ? "" : "s"} of your own to finish.`;
    }
    if (staleCount > 0) {
      return `You have <strong style="color:${INK};">${staleCount}</strong> row${staleCount === 1 ? "" : "s"} past their SLA on ${input.projectName}. Each one is waiting on someone.`;
    }
    return `You have <strong style="color:${INK};">${draftCount}</strong> draft${draftCount === 1 ? "" : "s"} of your own to finish on ${input.projectName}.`;
  })();

  return {
    to: input.to,
    subject: `[Siddhi] Waiting on you · ${input.projectName} — ${fmtDate(input.asOf)}`,
    html: shell({
      preheader: `${total} item${total === 1 ? "" : "s"} past their SLA on ${input.projectName}.`,
      headline: "Waiting on you",
      bodyHtml: `
        <p style="color:${INK};">${opener}</p>
        <p style="color:${INK_2}; margin-top:4px;">${lede}</p>
        <table role="presentation" cellpadding="0" cellspacing="0"
               style="border-collapse:collapse; width:100%; margin-top:14px;
                      border-top:1px solid ${RULE};">
          <tbody>${rowsHtml}</tbody>
        </table>
        <p style="color:${INK_2}; font-size:12.5px; margin-top:14px;">
          Fresh rows (still inside their SLA window) aren't listed here — this
          email is only about what's overdue.
        </p>
      `,
      cta: { text: "Open the app", url: homeBase },
      footer: `Automated from Siddhi — sent every weekday morning to people opted into daily site alerts.<br>
               A quiet day means no mail; if you'd rather stop entirely, an admin can toggle it off on your account.`,
    }),
  };
}
