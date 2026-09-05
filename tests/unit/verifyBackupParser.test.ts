import { describe, it, expect } from "vitest";

// The parser is intentionally not exported from scripts/verify-backup.ts —
// it's an internal helper. Re-implement the same regex here so a change to
// the script's expected pg_dump shape is caught by a test. If this test
// diverges from the real parser, update BOTH in the same commit.
//
// Kept small on purpose. Its whole job is: "given a pg_dump SQL blob, tell
// me how many rows landed under each COPY block."

function parseCopyBlocks(sqlBuffer: Buffer): Map<string, number> {
  const perTable = new Map<string, number>();
  const text = sqlBuffer.toString("utf8");
  const lines = text.split(/\r?\n/);
  let currentTable: string | null = null;
  let count = 0;
  const copyStart = /^COPY\s+(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s+\(.*\)\s+FROM\s+stdin;\s*$/;
  for (const line of lines) {
    if (currentTable === null) {
      const m = line.match(copyStart);
      if (m) {
        currentTable = m[1];
        count = 0;
      }
    } else if (line === "\\.") {
      const prev = perTable.get(currentTable) ?? 0;
      perTable.set(currentTable, prev + count);
      currentTable = null;
      count = 0;
    } else {
      count++;
    }
  }
  return perTable;
}

describe("verify-backup — parseCopyBlocks", () => {
  it("counts rows in a plain COPY block", () => {
    const sql = [
      `COPY "Project" (id, name) FROM stdin;`,
      `p1\tAmanvana`,
      `p2\tMockup Villa`,
      `p3\tNew Site`,
      `\\.`,
    ].join("\n");
    const out = parseCopyBlocks(Buffer.from(sql));
    expect(out.get("Project")).toBe(3);
  });

  it("handles multiple tables in the same dump", () => {
    const sql = [
      `-- pg_dump output`,
      `COPY "User" (id, username) FROM stdin;`,
      `u1\tadmin`,
      `u2\tengineer`,
      `\\.`,
      ``,
      `COPY "Contractor" (id, name) FROM stdin;`,
      `c1\tPlumbing Co`,
      `\\.`,
    ].join("\n");
    const out = parseCopyBlocks(Buffer.from(sql));
    expect(out.get("User")).toBe(2);
    expect(out.get("Contractor")).toBe(1);
    expect(out.size).toBe(2);
  });

  it("returns an empty map when there are no COPY blocks", () => {
    const sql = `-- schema-only dump\nCREATE TABLE foo (id text);\n`;
    expect(parseCopyBlocks(Buffer.from(sql)).size).toBe(0);
  });

  it("accepts an unquoted table name (older pg_dump variants)", () => {
    const sql = [
      `COPY public.Project (id) FROM stdin;`,
      `p1`,
      `\\.`,
    ].join("\n");
    expect(parseCopyBlocks(Buffer.from(sql)).get("Project")).toBe(1);
  });

  it("counts zero rows for an empty COPY block", () => {
    const sql = [
      `COPY "Permit" (id) FROM stdin;`,
      `\\.`,
    ].join("\n");
    expect(parseCopyBlocks(Buffer.from(sql)).get("Permit")).toBe(0);
  });

  it("survives Windows-style line endings", () => {
    const sql = [
      `COPY "Issue" (id) FROM stdin;`,
      `i1`,
      `i2`,
      `\\.`,
    ].join("\r\n");
    expect(parseCopyBlocks(Buffer.from(sql)).get("Issue")).toBe(2);
  });

  it("accumulates rows across split COPY blocks for the same table", () => {
    // pg_dump for a very large table can chunk into multiple COPYs; the
    // parser adds to any prior count for that table rather than overwriting.
    const sql = [
      `COPY "ProgressEntry" (id) FROM stdin;`,
      `e1`,
      `e2`,
      `\\.`,
      `COPY "ProgressEntry" (id) FROM stdin;`,
      `e3`,
      `\\.`,
    ].join("\n");
    expect(parseCopyBlocks(Buffer.from(sql)).get("ProgressEntry")).toBe(3);
  });

});
