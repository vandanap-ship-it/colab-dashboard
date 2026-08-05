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
  itemType: "Concern" | "Issue" | "Task";
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
