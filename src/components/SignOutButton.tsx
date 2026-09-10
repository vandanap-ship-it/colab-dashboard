"use client";

import { useRef, useState } from "react";
import { LogOut } from "lucide-react";

/**
 * Sign-out control with a confirm-before-submit safety.
 *
 * Previously the mobile Profile page had a bare `<form action=…><button…>Sign out</button></form>`,
 * so a single accidental tap in a scroll gesture immediately ended the
 * session — which for a site engineer mid-shift means losing offline
 * queue drafts and having to log back in on the phone.
 *
 * Wraps the same server action inside a client button that first shows
 * an inline confirm dialog. On confirm we submit the form via the ref;
 * on cancel nothing changes.
 */
export default function SignOutButton({
  action,
}: {
  /** The bound server-action to invoke when the user confirms. */
  action: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-stone-200 bg-white py-3 text-sm font-medium text-stone-900 hover:bg-stone-50 hover:border-stone-300 transition-colors"
      >
        <LogOut className="w-4 h-4 text-stone-400" />
        Sign out
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
      <p className="text-sm font-medium text-amber-900">Sign out of Siddhi?</p>
      <p className="text-xs text-amber-800">
        Any unsynced entries stay saved on this device and will send when
        you sign back in.
      </p>
      <form ref={formRef} action={action}>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-md border border-stone-300 bg-white text-stone-900 text-sm font-medium py-2.5 hover:bg-stone-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-stone-900 text-white text-sm font-medium py-2.5 hover:bg-stone-800"
          >
            Sign out
          </button>
        </div>
      </form>
    </div>
  );
}
