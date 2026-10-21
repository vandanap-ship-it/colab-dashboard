"use client";

import Link from "next/link";
import { ArrowLeft, Printer, ShieldCheck } from "lucide-react";

/**
 * Safety Induction ID card — printable. The card itself is laid out
 * at roughly CR80 proportions (85.6 × 54 mm, printed on A4), with a
 * screen view that's wider for readability. @media print collapses
 * the chrome (header, buttons) and reveals only the card.
 *
 * Fields match what the induction form collects, minus Aadhaar
 * (masked to last-4 per Vandana 2026-10-21). The signature image
 * sits at the bottom-right of the card like it would on a real ID.
 */
export default function InductionIdCard({
  projectId,
  projectName,
  induction,
}: {
  projectId: string;
  projectName: string;
  induction: {
    id: string;
    displayId: string;
    workerName: string;
    workerPhotoUrl: string | null;
    trade: string;
    contractorName: string | null;
    gender: string;
    age: number | null;
    dob: string | null;
    contactNumber: string | null;
    aadhaarNumber: string | null;
    signatureUrl: string | null;
    inductionDate: string;
    expiryDate: string;
  };
}) {
  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      {/* Chrome — hidden when printing. */}
      <header
        className="px-4 pt-4 pb-3 border-b border-sandstone-100 flex items-center gap-3 print:hidden"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <Link
          href={`/mobile/${projectId}/induction/${induction.id}`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-sandstone-100"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-[20px] leading-tight text-ink tracking-tight truncate">
            Safety ID card
          </h1>
          <p className="text-[12px] text-ink-3 truncate">
            {induction.workerName} · {induction.displayId}
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-ferrous-500 text-white text-sm font-semibold px-3 py-1.5 hover:bg-ferrous-600"
        >
          <Printer className="w-4 h-4" />
          Print
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6 print:p-0">
        <div className="id-card">
          {/* Top band — brand + project. */}
          <div className="id-card__top">
            <div className="id-card__brand">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>White Lotus · {projectName}</span>
            </div>
            <div className="id-card__badge">Safety Inducted</div>
          </div>

          {/* Hero — photo + name. */}
          <div className="id-card__hero">
            {induction.workerPhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- fixed URL from DB, print-sized
              <img
                src={induction.workerPhotoUrl}
                alt=""
                className="id-card__photo"
              />
            ) : (
              <div className="id-card__photo id-card__photo--empty">
                <ShieldCheck className="w-10 h-10 text-ferrous-600" />
              </div>
            )}
            <div className="id-card__who">
              <p className="id-card__name">{induction.workerName}</p>
              <p className="id-card__sub">{induction.trade}</p>
              {induction.contractorName && (
                <p className="id-card__sub id-card__sub--muted">{induction.contractorName}</p>
              )}
              <p className="id-card__ep">{induction.displayId}</p>
            </div>
          </div>

          {/* Details grid. */}
          <div className="id-card__details">
            {induction.dob && <IdRow label="Date of birth" value={fmtDate(induction.dob)} />}
            {induction.age != null && <IdRow label="Age" value={`${induction.age} yrs`} />}
            <IdRow label="Gender" value={induction.gender} />
            {induction.contactNumber && (
              <IdRow label="Contact" value={induction.contactNumber} />
            )}
            {induction.aadhaarNumber && (
              <IdRow label="Aadhaar" value={maskAadhaar(induction.aadhaarNumber)} />
            )}
            <IdRow label="Inducted on" value={fmtDate(induction.inductionDate)} />
            <IdRow label="Valid until" value={fmtDate(induction.expiryDate)} emphasize />
          </div>

          {/* Signature strip — bottom right if present. */}
          {induction.signatureUrl && (
            <div className="id-card__sig">
              <p className="id-card__sig-label">Signature</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={induction.signatureUrl} alt="" className="id-card__sig-img" />
            </div>
          )}
        </div>

        {/* Hint strip, screen only. */}
        <p className="mt-4 text-center text-[11px] text-ink-3 print:hidden">
          Tap <strong>Print</strong> above or use your browser's print dialog (Ctrl/Cmd + P). The chrome hides automatically.
        </p>
      </div>

      <style
        // Plain <style> element rather than styled-jsx (not configured
        // on this project) or a CSS module (no other file in the
        // induction tree uses one). Dangerously-set because the string
        // is a static literal, so there's no injection surface.
        dangerouslySetInnerHTML={{
          __html: `
        .id-card {
          width: 100%;
          max-width: 360px;
          margin: 0 auto;
          background: var(--color-white, #ffffff);
          border: 1px solid var(--color-sandstone-200, #e9d8c2);
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 1px 2px rgba(22, 25, 38, 0.04), 0 4px 12px rgba(22, 25, 38, 0.06);
          font-family: var(--font-body, 'Open Sans', Arial, sans-serif);
          color: var(--color-ink, #161926);
          position: relative;
        }
        .id-card__top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          background: var(--color-ferrous-500, #965532);
          color: #fff;
        }
        .id-card__brand {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          font-weight: 600;
        }
        .id-card__badge {
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          font-weight: 600;
          background: rgba(255, 255, 255, 0.18);
          padding: 3px 8px;
          border-radius: 999px;
        }
        .id-card__hero {
          display: grid;
          grid-template-columns: 88px 1fr;
          gap: 12px;
          padding: 14px;
          align-items: center;
        }
        .id-card__photo {
          width: 88px;
          height: 88px;
          border-radius: 999px;
          object-fit: cover;
          border: 2px solid var(--color-sandstone-200, #e9d8c2);
          background: var(--color-sandstone-50, #faf3e8);
        }
        .id-card__photo--empty {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .id-card__who {
          min-width: 0;
        }
        .id-card__name {
          font-family: var(--font-display, 'DM Serif Display', Georgia, serif);
          font-weight: 400;
          font-size: 18px;
          line-height: 1.15;
          margin: 0;
          color: var(--color-ink, #161926);
          word-break: break-word;
        }
        .id-card__sub {
          font-size: 12px;
          margin: 2px 0 0;
          color: var(--color-ink, #161926);
        }
        .id-card__sub--muted {
          color: var(--color-ink-3, #6b6d78);
        }
        .id-card__ep {
          margin: 6px 0 0;
          font-size: 11px;
          letter-spacing: 0.08em;
          font-weight: 600;
          color: var(--color-ferrous-600, #7f4727);
        }
        .id-card__details {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px 14px;
          padding: 10px 14px 14px;
          border-top: 1px dashed var(--color-sandstone-200, #e9d8c2);
          font-size: 12px;
        }
        .id-row__label {
          color: var(--color-ink-3, #6b6d78);
          font-size: 10px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin: 0;
        }
        .id-row__value {
          color: var(--color-ink, #161926);
          font-size: 13px;
          margin: 1px 0 0;
          font-weight: 500;
          word-break: break-word;
        }
        .id-row__value--emphasize {
          color: var(--color-ferrous-600, #7f4727);
          font-weight: 600;
        }
        .id-card__sig {
          padding: 0 14px 14px;
        }
        .id-card__sig-label {
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-ink-3, #6b6d78);
          margin: 0 0 4px;
        }
        .id-card__sig-img {
          height: 36px;
          max-width: 160px;
          object-fit: contain;
          display: block;
        }

        @media print {
          @page {
            size: A4;
            margin: 20mm;
          }
          html, body {
            background: #ffffff !important;
          }
          .id-card {
            box-shadow: none;
            border: 1px solid #c7bba7;
            max-width: 90mm;
          }
        }
      `,
        }}
      />
    </div>
  );
}

function IdRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div>
      <p className="id-row__label">{label}</p>
      <p className={`id-row__value ${emphasize ? "id-row__value--emphasize" : ""}`}>{value}</p>
    </div>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/** 12-digit Aadhaar → "XXXX XXXX 1234" per Vandana 2026-10-21.
 *  Keeps the printed card from being usable as a secondary Aadhaar
 *  document; Siddhi still holds the full number for lookup. */
function maskAadhaar(n: string): string {
  const digits = n.replace(/\D/g, "");
  if (digits.length < 4) return "XXXX XXXX XXXX";
  const last4 = digits.slice(-4);
  return `XXXX XXXX ${last4}`;
}
