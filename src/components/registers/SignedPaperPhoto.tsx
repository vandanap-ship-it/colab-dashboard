"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";

/**
 * Optional photo of the wet-signed paper register, for the transition
 * period while the site still files paper. Preparer or approver can
 * attach / replace it on any sign-off.
 */
export default function SignedPaperPhoto({
  submissionId,
  projectId,
  url,
  canEdit,
}: {
  submissionId: string;
  projectId: string;
  url: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("scope", `register-signed-${projectId}`);
      fd.append("file", file);
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      const upData = await up.json().catch(() => null);
      const uploaded: string | undefined = upData?.urls?.[0];
      if (!up.ok || !uploaded) throw new Error(upData?.error ?? "Photo upload failed");
      const res = await fetch(`/api/register-submissions/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedPaperUrl: uploaded }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't save the photo");
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the photo");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  if (!url && !canEdit) return null;

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 space-y-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">Signed paper copy</h2>
      {url ? (
        <a href={url} target="_blank" rel="noopener" className="block w-32 aspect-[3/4] rounded-lg overflow-hidden border border-stone-200 bg-stone-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Signed paper register" className="w-full h-full object-cover" loading="lazy" />
        </a>
      ) : (
        <p className="text-[12px] text-stone-500">Optional — attach a photo of the signed paper sheet if one was filed.</p>
      )}
      {canEdit && (
        <>
          <input
            ref={input}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-100 text-ink text-[13px] font-semibold px-3 py-2 disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            {url ? "Replace photo" : "Attach photo"}
          </button>
        </>
      )}
      {error && <p className="text-[12px] text-red-700">{error}</p>}
    </section>
  );
}
