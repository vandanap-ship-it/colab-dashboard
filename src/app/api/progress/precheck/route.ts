import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPrecheck } from "@/lib/progressGates";

/**
 * GET /api/progress/precheck?wbsNodeId=…
 *
 * Client-side companion to the server enforcement in POST /api/progress —
 * the mobile Log Progress form calls this the moment an activity is picked
 * so the engineer sees the gate before they scroll to Save. Doesn't create
 * anything; just answers "would this progress row be allowed right now?"
 * so the form can render a banner and disable the submit button.
 *
 * Auth-required; no module gate beyond that — a hindrance-only contractor
 * asking whether a gated concreting activity is unlocked leaks nothing.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const wbsNodeId = searchParams.get("wbsNodeId");
  if (!wbsNodeId) return NextResponse.json({ error: "wbsNodeId required" }, { status: 400 });

  const result = await checkPrecheck(wbsNodeId);
  return NextResponse.json(result);
}
