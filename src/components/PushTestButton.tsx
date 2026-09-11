"use client";

import { useState } from "react";
import { Bell } from "lucide-react";

/**
 * "Send me a test notification" button on the mobile Profile page.
 *
 * Simple wrapper around POST /api/push/test which sends a push to the
 * current user's own opted-in devices. If they haven't opted in yet,
 * the API returns hint text pointing them at the mobile-home banner.
 */
export default function PushTestButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/push/test", { method: "POST", credentials: "include" });
      const d = await r.json();
      setMsg(d.hint || (r.ok ? "Sent." : "Failed."));
    } catch {
      setMsg("Failed to send. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={send}
        disabled={busy}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-stone-200 bg-white py-2.5 text-sm font-medium text-stone-900 hover:bg-stone-50 hover:border-stone-300 disabled:opacity-60 transition-colors"
      >
        <Bell className="w-4 h-4 text-stone-400" />
        {busy ? "Sending…" : "Send me a test notification"}
      </button>
      {msg && <p className="text-[11px] text-stone-500 text-center">{msg}</p>}
    </div>
  );
}
