import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assignmentEmail,
  milestoneCompletionEmail,
  overdueDigestEmail,
  sendEmail,
  DEFAULT_RECIPIENTS,
} from "@/lib/email";

const d = (iso: string) => new Date(iso + "T00:00:00Z");

// ---------------------------------------------------------------------------
// Template renderers (pure — subject + html shape)
// ---------------------------------------------------------------------------

describe("assignmentEmail", () => {
  it("sets a clear subject line with item type + title", () => {
    const out = assignmentEmail({
      to: "u@example.com",
      assigneeName: "Priya",
      itemType: "Concern",
      itemTitle: "Uneven plaster on Villa 12 GF wall",
      itemUrl: "https://x/y",
    });
    expect(out.subject).toBe("[Siddhi] Concern assigned: Uneven plaster on Villa 12 GF wall");
    expect(out.to).toBe("u@example.com");
    expect(out.html).toContain("Priya");
    expect(out.html).toContain("Uneven plaster");
    expect(out.html).toContain("https://x/y");
  });

  it("includes a due date row when provided", () => {
    const out = assignmentEmail({
      to: "u@e.com", assigneeName: "P", itemType: "Task",
      itemTitle: "T", itemUrl: "u",
      dueDate: d("2026-09-15"),
    });
    // Fixed UTC-based formatter — deterministic across Node versions & TZs.
    expect(out.html).toContain("15 Sep 2026");
    expect(out.html).toContain("Due:");
  });

  it("omits raised-by line when not provided", () => {
    const out = assignmentEmail({
      to: "u@e.com", assigneeName: "P", itemType: "Task",
      itemTitle: "T", itemUrl: "u",
    });
    expect(out.html).not.toContain("Raised by");
  });
});

describe("milestoneCompletionEmail", () => {
  it("shows ON-TIME chip when actual ≤ baseline", () => {
    const out = milestoneCompletionEmail({
      projectName: "Amanvana",
      villaLabel: "Villa 12",
      sectionName: "Foundation / Substructure",
      actualFinish: d("2026-01-08"),
      baselineFinish: d("2026-01-10"),
      dashboardUrl: "https://x",
    });
    expect(out.subject).toBe("[Siddhi] Villa 12 · Foundation / Substructure completed");
    expect(out.html).toContain("ON-TIME");
    expect(out.html).not.toContain("LATE");
  });

  it("shows LATE chip with day count when actual > baseline", () => {
    const out = milestoneCompletionEmail({
      projectName: "Amanvana",
      villaLabel: "Villa 10 & 11",
      sectionName: "Foundation / Substructure",
      actualFinish: d("2026-07-04"),
      baselineFinish: d("2026-04-27"),
      dashboardUrl: "https://x",
    });
    expect(out.html).toContain("68d LATE");
    // Grouped villa label preserved verbatim (assertion split around the ampersand
    // to stay agnostic to HTML entity encoding of "&").
    expect(out.html).toMatch(/Villa 10\s*(&|&amp;)\s*11/);
  });

  it("defaults recipients to DEFAULT_RECIPIENTS when to is omitted", () => {
    const out = milestoneCompletionEmail({
      projectName: "Amanvana",
      villaLabel: "Villa 25",
      sectionName: "Plinth Level",
      actualFinish: d("2026-06-25"),
      baselineFinish: d("2026-06-24"),
      dashboardUrl: "https://x",
    });
    expect(out.to).toEqual(DEFAULT_RECIPIENTS);
  });

  it("honours custom recipients when passed", () => {
    const out = milestoneCompletionEmail({
      to: ["ceo@white.in"],
      projectName: "Amanvana", villaLabel: "Villa 25",
      sectionName: "Plinth Level",
      actualFinish: d("2026-06-25"), baselineFinish: d("2026-06-24"),
      dashboardUrl: "https://x",
    });
    expect(out.to).toEqual(["ceo@white.in"]);
  });

  it("omits baseline row when baseline is null (unusual but supported)", () => {
    const out = milestoneCompletionEmail({
      projectName: "Amanvana",
      villaLabel: "Villa 12",
      sectionName: "Foundation / Substructure",
      actualFinish: d("2026-07-04"),
      baselineFinish: null,
      dashboardUrl: "https://x",
    });
    expect(out.html).not.toContain("Baseline finish");
    expect(out.html).not.toContain("ON-TIME");
    expect(out.html).not.toContain("LATE");
  });
});

describe("overdueDigestEmail", () => {
  it("returns null when there are no overdue items (don't spam)", () => {
    const out = overdueDigestEmail({
      projectName: "Amanvana",
      dashboardUrl: "https://x",
      items: [],
      asOf: d("2026-08-06"),
    });
    expect(out).toBe(null);
  });

  it("singularises subject for one item", () => {
    const out = overdueDigestEmail({
      projectName: "Amanvana",
      dashboardUrl: "https://x",
      asOf: d("2026-08-06"),
      items: [{ villaLabel: "Villa 12", sectionName: "Foundation", baselineFinish: d("2026-04-27"), slipDays: 68, currentPct: 100 }],
    });
    expect(out?.subject).toBe("[Siddhi] 1 milestone overdue on Amanvana");
  });

  it("pluralises subject for many items and caps rows in body", () => {
    const many = Array.from({ length: 45 }, (_, i) => ({
      villaLabel: `Villa ${i + 10}`,
      sectionName: "Foundation",
      baselineFinish: d("2026-04-27"),
      slipDays: 100 - i,
      currentPct: 0,
    }));
    const out = overdueDigestEmail({
      projectName: "Amanvana",
      dashboardUrl: "https://x",
      asOf: d("2026-08-06"),
      items: many,
    });
    expect(out?.subject).toBe("[Siddhi] 45 milestones overdue on Amanvana");
    // Body shows first 30, plus "Showing 30 of 45"
    expect(out?.html).toContain("Showing 30 of 45");
  });
});

// ---------------------------------------------------------------------------
// sendEmail — the fetch shim behaves correctly
// ---------------------------------------------------------------------------

describe("sendEmail", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.RESEND_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it("no-ops (skipped: true) when RESEND_API_KEY is missing", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await sendEmail({ to: "x@y", subject: "s", html: "h" });
    expect(r).toEqual({ ok: true, skipped: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it("posts to Resend when key present and returns the message id", async () => {
    process.env.RESEND_API_KEY = "test_key";
    const mockFetch = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ id: "msg_123" }), { status: 200 }),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    const r = await sendEmail({ to: "x@y.com", subject: "s", html: "<p>h</p>" });
    expect(r).toEqual({ ok: true, id: "msg_123" });
    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer test_key");
  });

  it("returns ok:false with error text on non-200 responses", async () => {
    process.env.RESEND_API_KEY = "test_key";
    globalThis.fetch = vi.fn(async () =>
      new Response("rate limited", { status: 429 }),
    ) as unknown as typeof fetch;
    const r = await sendEmail({ to: "x@y", subject: "s", html: "h" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("429");
    expect(r.error).toContain("rate limited");
  });

  it("swallows fetch exceptions rather than throwing", async () => {
    process.env.RESEND_API_KEY = "test_key";
    globalThis.fetch = vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    const r = await sendEmail({ to: "x@y", subject: "s", html: "h" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("network down");
  });
});
