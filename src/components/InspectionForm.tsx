"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, X } from "lucide-react";
import VoiceTextarea from "./VoiceTextarea";
import { useToast } from "./Toast";
import PhotoPicker from "./PhotoPicker";
import SaveSuccessCard from "./SaveSuccessCard";
import { itemState } from "@/lib/inspectionItemState";

type Activity = { id: string; name: string; taskCode: string; path: string[] };

type TemplateItem = { seq: number; section: string | null; description: string };
type Template = {
  id: string;
  code: string;
  name: string;
  activity: string | null;
  module: string | null;
  items: TemplateItem[];
};

type Reviewer = { id: string; name: string | null; username: string; role: string };

type ChecklistItem = {
  label: string;
  passed: boolean | null;
  notApplicable: boolean;
  notes: string;
  // Per-row photo (Colab parity). Two orthogonal slots:
  //   photo   — a new file the filler just captured, uploaded on save
  //   photoUrl — an already-saved URL carried through from a draft
  // On save, a new `photo` uploads and its URL wins over the existing
  // `photoUrl`. When `photo` is null, `photoUrl` is preserved verbatim.
  // Both null means the row has no picture at all.
  photo: File | null;
  photoUrl: string | null;
};

/**
 * Snapshot of a draft, passed in when resuming an existing DRAFT.
 * Kept in the SAME shape as what the form serializes on save so the
 * roundtrip is transparent: reader-facing state names align 1:1.
 */
export type EditDraftInput = {
  id: string;
  expectedUpdatedAt: string;
  title: string;
  wbsNodeId: string | null;
  submitRemark: string | null;
  assignedReviewerIds: string[];
  items: Array<{
    label: string;
    passed: boolean | null;
    notApplicable: boolean;
    notes: string | null;
    photoUrl: string | null;
  }>;
  photoUrls: string[];
};

const DEFAULT_ITEMS = [
  "All work matches drawings",
  "Materials per spec",
  "Workmanship quality acceptable",
  "Safety practices followed",
  "Site cleaned after work",
];

const REVIEWER_ROLES = new Set(["PLANNER", "PRODUCT_TEAM", "ADMIN", "SITE_MANAGER"]);

// Same client-side downscale as PhotoPicker. Duplicated intentionally: the
// per-row picker is a single-file capture with a much smaller UI, and
// pulling it out to a shared helper isn't worth the extra dependency
// surface for one call site.
async function compressImage(file: File): Promise<File> {
  const isHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.(heic|heif)$/i.test(file.name);
  if (isHeic || !file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8),
    );
    if (!blob) return file;
    if (blob.size >= file.size * 0.95) return file;
    return new File([blob], file.name.replace(/\.(png|webp|gif|heic|heif|tiff)$/i, ".jpg"), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

export default function InspectionForm({
  projectId,
  editDraft,
  initialWbsNodeId,
}: {
  projectId: string;
  // `redirectTo` was accepted in an earlier iteration but never wired up.
  // The post-save success card handles the "what next" affordance, so
  // there's nothing to redirect to. Kept out of the destructure so the
  // linter stays clean; callers passing it are ignored.
  redirectTo?: string;
  // When present, the form is in edit mode: state pre-fills from this
  // snapshot, the Save button PUTs to the draft endpoint, and Send For
  // Review promotes the DRAFT to IN_REVIEW instead of creating a new
  // one. Absent → the standard "new WIR" flow (POST creates fresh).
  editDraft?: EditDraftInput;
  // Deep-link entry point — a caller (typically the Log Progress
  // precheck callout) passes the activity the WIR should be filed
  // against. Ignored when editDraft is set, since that snapshot
  // already carries its own wbsNodeId.
  initialWbsNodeId?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const isEditingDraft = !!editDraft;
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [activityId, setActivityId] = useState(editDraft?.wbsNodeId ?? initialWbsNodeId ?? "");
  const [activitySearch, setActivitySearch] = useState("");
  const [title, setTitle] = useState(editDraft?.title ?? "");
  const [items, setItems] = useState<ChecklistItem[]>(
    editDraft
      ? editDraft.items.map((i) => ({
          label: i.label,
          passed: i.passed,
          notApplicable: i.notApplicable,
          notes: i.notes ?? "",
          photo: null,
          photoUrl: i.photoUrl,
        }))
      : DEFAULT_ITEMS.map((label) => ({ label, passed: null, notApplicable: false, notes: "", photo: null, photoUrl: null })),
  );
  const [photos, setPhotos] = useState<File[]>([]);
  // Whole-checklist photos already saved on this draft. Rendered as a
  // read-only strip above the PhotoPicker so the filler can see what's
  // there; new photos added via the picker append on save. Delete-a-
  // saved-photo is a follow-up.
  const [existingWholePhotos] = useState<string[]>(editDraft?.photoUrls ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<Set<string>>(
    new Set(editDraft?.assignedReviewerIds ?? []),
  );
  // Send-For-Review popup — Colab's step 7 flow. Opens a bottom sheet with
  // a remark textarea before the actual POST.
  const [sendPopupOpen, setSendPopupOpen] = useState(false);
  const [submitRemark, setSubmitRemark] = useState(editDraft?.submitRemark ?? "");
  // Reschedule popup — Colab's third button. Opens a date picker + note.
  const [reschedPopupOpen, setReschedPopupOpen] = useState(false);
  const [reschedDate, setReschedDate] = useState(() => {
    // Default: tomorrow. A "reschedule to today" is legal but rare — usually
    // the user is pushing this a day or two out.
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [reschedNote, setReschedNote] = useState("");
  // Three finish paths: sent for review (default), rescheduled, or saved
  // as a draft. The saved state carries which so the success card can
  // pick the right copy and the reset flow works the same way for all
  // three.
  const [saved, setSaved] = useState<null | { queued: boolean; title: string; outcome: "review" | "reschedule" | "draft" }>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/wbs?leaves=true`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { nodes: [] }))
      .then((d) => {
        if (!cancelled) setActivities(d.nodes ?? []);
      })
      .catch(() => {
        if (!cancelled) setActivities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/inspection-templates", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => {
        if (!cancelled) setTemplates(d.templates ?? []);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the reviewer pool once. Client-side filters to the roles that
  // can actually review inspections; the server ultimately re-checks so
  // this list is only about the picker UI.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/users", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => {
        if (cancelled) return;
        const eligible: Reviewer[] = (d.users ?? []).filter((u: Reviewer) => REVIEWER_ROLES.has(u.role));
        setReviewers(eligible);
      })
      .catch(() => {
        if (!cancelled) setReviewers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function applyTemplate(id: string) {
    setTemplateId(id);
    if (!id) return;
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    setTitle((cur) => cur.trim() || tpl.name);
    setItems(
      tpl.items
        .slice()
        .sort((a, b) => a.seq - b.seq)
        .map((it) => ({ label: it.description, passed: null, notApplicable: false, notes: "", photo: null, photoUrl: null })),
    );
  }

  const filtered = useMemo(() => {
    if (!activities) return [];
    const q = activitySearch.trim().toLowerCase();
    if (!q) return activities.slice(0, 50);
    return activities
      .filter((a) => a.name.toLowerCase().includes(q) || a.path.join(" / ").toLowerCase().includes(q))
      .slice(0, 50);
  }, [activities, activitySearch]);

  const selected = activities?.find((a) => a.id === activityId);

  function updateItem(i: number, patch: Partial<ChecklistItem>) {
    setItems((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addItem() {
    setItems((rows) => [...rows, { label: "", passed: null, notApplicable: false, notes: "", photo: null, photoUrl: null }]);
  }
  function removeItem(i: number) {
    setItems((rows) => rows.filter((_, idx) => idx !== i));
  }

  function toggleReviewer(id: string) {
    setSelectedReviewerIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Shared validation: enforces the same rule for both Send For Review and
  // Reschedule — a WIR must have a real title, at least one non-empty row,
  // and every non-empty row must be answered Yes / No / NA. Reschedule
  // deliberately does NOT relax this: an inspection you park should still
  // reflect the state of what you saw on site today. Save-as-Draft uses a
  // separate looser validation below.
  function validate(): { ok: true; usable: ChecklistItem[] } | { ok: false; error: string } {
    if (title.trim().length < 3) return { ok: false, error: "Title too short" };
    const usable = items.filter((i) => i.label.trim().length > 0);
    if (usable.length === 0) return { ok: false, error: "Add at least one item" };
    const untouched = usable.filter((i) => itemState(i) === "untouched");
    if (untouched.length > 0) {
      const first = untouched[0].label.trim();
      const more = untouched.length > 1 ? ` (+${untouched.length - 1} more)` : "";
      return { ok: false, error: `Tick Yes, No or N/A for "${first}"${more}.` };
    }
    return { ok: true, usable };
  }

  // Save-as-Draft validation. Only two invariants a draft has to hold:
  //   1. A real title, so the filler can find the draft again.
  //   2. At least one non-empty row, so we don't stack up empty drafts.
  // Every row's Yes/No/NA state is open — the whole point of a draft is
  // that the checklist isn't finished yet.
  function validateDraft(): { ok: true; usable: ChecklistItem[] } | { ok: false; error: string } {
    if (title.trim().length < 3) return { ok: false, error: "Give the draft a title so you can find it later." };
    const usable = items.filter((i) => i.label.trim().length > 0);
    if (usable.length === 0) return { ok: false, error: "Add at least one row before saving as draft." };
    return { ok: true, usable };
  }

  // Upload every per-row photo in one FormData batch, keeping their
  // positional index aligned. Blob URLs would be simpler client-side but
  // the server needs a URL; we upload here rather than at row-tap so an
  // offline session can still fill the checklist and photos go out with
  // the row payload as one atomic thing.
  async function uploadItemPhotos(usable: ChecklistItem[]): Promise<{ urls: (string | null)[]; warning: string | null }> {
    const indices: number[] = [];
    const files: File[] = [];
    usable.forEach((it, idx) => {
      if (it.photo) {
        indices.push(idx);
        files.push(it.photo);
      }
    });
    const urls: (string | null)[] = usable.map(() => null);
    if (files.length === 0) return { urls, warning: null };
    const fd = new FormData();
    fd.set("scope", `inspection-item-${projectId}`);
    for (const f of files) fd.append("file", f);
    try {
      const upRes = await fetch("/api/upload", { method: "POST", body: fd });
      if (upRes.ok) {
        const { urls: gotUrls } = await upRes.json();
        gotUrls.forEach((u: string, i: number) => {
          urls[indices[i]] = u;
        });
        return { urls, warning: null };
      }
      const data = await upRes.json().catch(() => null);
      return { urls, warning: data?.error ?? `Row photo upload failed (status ${upRes.status})` };
    } catch (e) {
      return { urls, warning: e instanceof Error ? `Row photo upload failed: ${e.message}` : "Row photo upload failed" };
    }
  }

  async function uploadWholePhotos(): Promise<{ urls: string[]; warning: string | null }> {
    if (photos.length === 0) return { urls: [], warning: null };
    const fd = new FormData();
    fd.set("scope", `inspection-${projectId}`);
    for (const p of photos) fd.append("file", p);
    try {
      const upRes = await fetch("/api/upload", { method: "POST", body: fd });
      if (upRes.ok) return { urls: (await upRes.json()).urls, warning: null };
      const data = await upRes.json().catch(() => null);
      return { urls: [], warning: data?.error ?? `Photo upload failed (status ${upRes.status})` };
    } catch (e) {
      return { urls: [], warning: e instanceof Error ? `Photo upload failed: ${e.message}` : "Photo upload failed" };
    }
  }

  // Send For Review — Colab's default finish. Uploads any photos, POSTs
  // the inspection, and if reviewers were picked they go in the payload
  // so the server knows to route the pushes only to them.
  async function submitForReview(remark: string) {
    const v = validate();
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setPending(true);
    setError(null);
    setSendPopupOpen(false);

    const [rowPhotos, wholePhotos] = await Promise.all([
      uploadItemPhotos(v.usable),
      uploadWholePhotos(),
    ]);

    // Shared row-payload shape — same on POST (new WIR) and PUT (draft
    // edit → review). photoUrl falls back to the row's existing photoUrl
    // when no new file was uploaded this session, so resume-editing a
    // draft doesn't drop the photos the filler already captured.
    const items = v.usable.map((it, idx) => ({
      label: it.label,
      passed: it.passed,
      notApplicable: it.notApplicable,
      notes: it.notes,
      photoUrl: rowPhotos.urls[idx] ?? it.photoUrl ?? null,
    }));

    // Edit mode → PUT the draft with mode=review, which server-side
    // promotes DRAFT → IN_REVIEW and fires the push. Fresh WIR → POST
    // to /api/inspections as before.
    const endpoint = isEditingDraft ? `/api/inspections/${editDraft!.id}/draft` : "/api/inspections";
    const method = isEditingDraft ? "PUT" : "POST";
    const payload: Record<string, unknown> = {
      wbsNodeId: activityId || undefined,
      title: title.trim(),
      items,
      // On edit-mode-and-review, only newly uploaded whole-photos ship
      // in the payload — existing ones stay on the row untouched.
      photoUrls: wholePhotos.urls,
      assignedReviewerIds: Array.from(selectedReviewerIds),
      submitRemark: remark.trim() || undefined,
    };
    if (isEditingDraft) {
      payload.mode = "review";
      payload.expectedUpdatedAt = editDraft!.expectedUpdatedAt;
    } else {
      payload.idempotencyKey = crypto.randomUUID();
      payload.projectId = projectId;
    }

    let queued = false;
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        // saved
      } else if (res.status >= 400 && res.status < 500) {
        const data = await res.json().catch(() => null);
        setPending(false);
        setError(data?.error ?? `Save failed (${res.status})`);
        return;
      } else if (!isEditingDraft) {
        // Only queue for fresh WIRs — a draft edit is per-user, per-
        // draft, and doesn't idempotent-replay cleanly through the
        // offline queue. If the PUT fails on a real 5xx, the filler
        // sees the error and retries themselves.
        const { enqueue } = await import("@/lib/offlineQueue");
        await enqueue({ endpoint, method, body: payload, label: `Inspection: ${title.trim()}` });
        queued = true;
      } else {
        const data = await res.json().catch(() => null);
        setPending(false);
        setError(data?.error ?? `Server error (${res.status}) — please try again.`);
        return;
      }
    } catch {
      if (!isEditingDraft) {
        const { enqueue } = await import("@/lib/offlineQueue");
        await enqueue({ endpoint, method, body: payload, label: `Inspection: ${title.trim()}` });
        queued = true;
      } else {
        setPending(false);
        setError("Network offline — please try again when connected.");
        return;
      }
    }
    setPending(false);

    if (queued) toast.info("Saved on this device. It will sync when you're back online.");
    else toast.success(isEditingDraft ? "Draft sent for review." : "Inspection sent for review.");
    if (rowPhotos.warning) toast.warning(rowPhotos.warning);
    if (wholePhotos.warning) toast.warning(wholePhotos.warning);

    setSaved({ queued, title: title.trim(), outcome: "review" });
    router.refresh();
  }

  // Save-as-Draft — Colab step 7 third button. Same POST endpoint with
  // mode=draft, which server-side skips the "every row must be answered"
  // validation and skips the reviewer push. Client-side we run the
  // looser validation (title + at least one non-empty row) so a filler
  // can pause partway through a 20-item checklist without losing the
  // work they've already done.
  async function saveDraft() {
    const v = validateDraft();
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setPending(true);
    setError(null);

    const [rowPhotos, wholePhotos] = await Promise.all([
      uploadItemPhotos(v.usable),
      uploadWholePhotos(),
    ]);

    // Same shared row shape as submitForReview — see the comment there.
    const items = v.usable.map((it, idx) => ({
      label: it.label,
      passed: it.passed,
      notApplicable: it.notApplicable,
      notes: it.notes,
      photoUrl: rowPhotos.urls[idx] ?? it.photoUrl ?? null,
    }));

    // Edit mode → PUT with mode=draft. Fresh WIR → POST with mode=draft.
    // Reviewers + submitRemark are deliberately included even though
    // the API skips the push for drafts — they belong to the WIR the
    // draft will BECOME on Send For Review, so preserving them through
    // the resume-edit round trip means the filler doesn't have to
    // re-pick the same reviewers when they come back.
    const endpoint = isEditingDraft ? `/api/inspections/${editDraft!.id}/draft` : "/api/inspections";
    const method = isEditingDraft ? "PUT" : "POST";
    const payload: Record<string, unknown> = {
      wbsNodeId: activityId || undefined,
      title: title.trim(),
      items,
      photoUrls: wholePhotos.urls,
      assignedReviewerIds: Array.from(selectedReviewerIds),
      submitRemark: submitRemark.trim() || undefined,
      mode: "draft" as const,
    };
    if (isEditingDraft) {
      payload.expectedUpdatedAt = editDraft!.expectedUpdatedAt;
    } else {
      payload.idempotencyKey = crypto.randomUUID();
      payload.projectId = projectId;
    }

    let queued = false;
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        // saved
      } else if (res.status >= 400 && res.status < 500) {
        const data = await res.json().catch(() => null);
        setPending(false);
        setError(data?.error ?? `Draft save failed (${res.status})`);
        return;
      } else if (!isEditingDraft) {
        const { enqueue } = await import("@/lib/offlineQueue");
        await enqueue({ endpoint, method, body: payload, label: `Draft: ${title.trim()}` });
        queued = true;
      } else {
        const data = await res.json().catch(() => null);
        setPending(false);
        setError(data?.error ?? `Server error (${res.status}) — please try again.`);
        return;
      }
    } catch {
      if (!isEditingDraft) {
        const { enqueue } = await import("@/lib/offlineQueue");
        await enqueue({ endpoint, method, body: payload, label: `Draft: ${title.trim()}` });
        queued = true;
      } else {
        setPending(false);
        setError("Network offline — please try again when connected.");
        return;
      }
    }
    setPending(false);

    if (queued) toast.info("Draft saved on this device. It will sync when you're back online.");
    else toast.success(isEditingDraft ? "Draft updated." : "Draft saved.");
    if (rowPhotos.warning) toast.warning(rowPhotos.warning);
    if (wholePhotos.warning) toast.warning(wholePhotos.warning);

    setSaved({ queued, title: title.trim(), outcome: "draft" });
    router.refresh();
  }

  // Reschedule — Colab's third button. Two-step: create the WIR (same
  // shape as Send For Review), then hit the reschedule endpoint with the
  // date + note. If the create fails, the reschedule never fires — the
  // WIR is either fully committed and parked, or nothing.
  async function submitAndReschedule(date: string, note: string) {
    const v = validate();
    if (!v.ok) {
      setError(v.error);
      return;
    }
    if (!date) {
      setError("Pick a date to reschedule to.");
      return;
    }
    setPending(true);
    setError(null);
    setReschedPopupOpen(false);

    const [rowPhotos, wholePhotos] = await Promise.all([
      uploadItemPhotos(v.usable),
      uploadWholePhotos(),
    ]);

    const payload = {
      idempotencyKey: crypto.randomUUID(),
      projectId,
      wbsNodeId: activityId || undefined,
      title: title.trim(),
      items: v.usable.map((it, idx) => ({
        label: it.label,
        passed: it.passed,
        notApplicable: it.notApplicable,
        notes: it.notes,
        photoUrl: rowPhotos.urls[idx] ?? it.photoUrl ?? null,
      })),
      photoUrls: wholePhotos.urls,
      assignedReviewerIds: Array.from(selectedReviewerIds),
      submitRemark: undefined,
    };

    let inspectionId: string | null = null;
    try {
      const res = await fetch("/api/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        inspectionId = data?.inspection?.id ?? null;
      } else {
        const data = await res.json().catch(() => null);
        setPending(false);
        setError(data?.error ?? `Save failed (${res.status}) — nothing was rescheduled.`);
        return;
      }
    } catch {
      setPending(false);
      setError("Network is offline. Reschedule can't run — please try again when connected.");
      return;
    }

    if (!inspectionId) {
      setPending(false);
      setError("Inspection was saved but its id came back blank — please refresh and reschedule from the queue.");
      return;
    }

    try {
      const res = await fetch(`/api/inspections/${inspectionId}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rescheduledFor: date, note: note.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setPending(false);
        toast.warning(`Saved, but reschedule failed: ${data?.error ?? res.status}`);
        setSaved({ queued: false, title: title.trim(), outcome: "review" });
        router.refresh();
        return;
      }
    } catch {
      setPending(false);
      toast.warning("Saved, but reschedule couldn't reach the server.");
      setSaved({ queued: false, title: title.trim(), outcome: "review" });
      router.refresh();
      return;
    }

    setPending(false);
    toast.success(`Rescheduled to ${date}.`);
    if (rowPhotos.warning) toast.warning(rowPhotos.warning);
    if (wholePhotos.warning) toast.warning(wholePhotos.warning);
    setSaved({ queued: false, title: title.trim(), outcome: "reschedule" });
    router.refresh();
  }

  function resetForm() {
    setActivityId("");
    setActivitySearch("");
    setTitle("");
    setItems(DEFAULT_ITEMS.map((label) => ({ label, passed: null, notApplicable: false, notes: "", photo: null, photoUrl: null })));
    setPhotos([]);
    setTemplateId("");
    setSelectedReviewerIds(new Set());
    setSubmitRemark("");
    setReschedNote("");
    setError(null);
    setSaved(null);
  }

  if (saved) {
    // Success-card copy branches on the finish path AND on edit-mode:
    // an edit-mode "draft" is an UPDATE (existing draft), an edit-mode
    // "review" is a PROMOTE (draft became a WIR). Fresh-form outcomes
    // stay as they were.
    const cardTitle =
      saved.outcome === "reschedule"
        ? "Inspection rescheduled"
        : saved.outcome === "draft"
          ? (isEditingDraft ? "Draft updated" : "Draft saved")
          : (isEditingDraft ? "Draft sent for review" : "Inspection saved");
    const cardDetail =
      saved.outcome === "reschedule"
        ? `${saved.title} — parked for a later day.`
        : saved.outcome === "draft"
          ? (isEditingDraft
              ? `${saved.title} — still in your Drafts tab. Open it again anytime.`
              : `${saved.title} — saved as a draft. Only you can see it in your Drafts tab.`)
          : `${saved.title} — sent for planner review.`;
    return (
      <SaveSuccessCard
        title={cardTitle}
        detail={cardDetail}
        projectId={projectId}
        onAddAnother={resetForm}
        queued={saved.queued}
      />
    );
  }

  const untouchedCount = items.filter((it) => it.label.trim().length > 0 && itemState(it) === "untouched").length;

  return (
    <form onSubmit={(e) => { e.preventDefault(); setSendPopupOpen(true); }} className="px-5 py-5 space-y-5">
      <header>
        <p className="font-serif italic text-[13px] text-ferrous-600 tracking-wide">
          Work inspection record
        </p>
        <h1 className="font-serif text-[28px] leading-tight text-ink tracking-tight mt-1">
          {isEditingDraft ? "Continue your draft" : "Fill a checklist"}
        </h1>
        <p className="text-[13px] text-ink-3 mt-1.5">
          {isEditingDraft
            ? "Your previous answers are pre-filled. Save Draft to keep working, or Send For Review to finish."
            : "Pick a template, mark every row, then Save Draft, Reschedule, or Send For Review."}
        </p>
      </header>

      {templates.length > 0 && (
        <label className="block">
          <span className="text-sm font-medium text-stone-700">
            Start from a template <span className="text-stone-400">(optional)</span>
          </span>
          <select
            value={templateId}
            onChange={(e) => applyTemplate(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Blank checklist</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code}: {t.name}
                {t.items.length ? ` (${t.items.length} items)` : ""}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-stone-500">
            Loads the standard checkpoints. You can still edit, add, or remove items.
          </span>
        </label>
      )}

      <label className="block">
        <span className="text-sm font-medium text-stone-700">Title</span>
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Earth Bedroom — Final paint check"
          className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        />
      </label>

      <div className="space-y-2">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">
            Activity <span className="text-stone-400">(optional)</span>
          </span>
          <input
            type="text"
            placeholder="Search activity…"
            value={activitySearch}
            onChange={(e) => setActivitySearch(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <div className="max-h-40 overflow-y-auto rounded-md border border-stone-200 divide-y divide-stone-100">
          <button
            type="button"
            onClick={() => setActivityId("")}
            className={`w-full text-left px-3 py-2 ${activityId === "" ? "bg-amber-50" : ""}`}
          >
            <div className="text-xs text-stone-500">No specific activity</div>
          </button>
          {filtered.map((a) => (
            <button
              type="button"
              key={a.id}
              onClick={() => setActivityId(a.id)}
              className={`w-full text-left px-3 py-2 ${activityId === a.id ? "bg-amber-50" : ""}`}
            >
              <div className="text-sm font-medium text-stone-900">{a.name}</div>
              <div className="text-[10px] text-stone-500">{a.path.slice(0, -1).join(" / ")}</div>
            </button>
          ))}
        </div>
        {selected && (
          <p className="text-xs text-stone-600">Selected: {selected.name}</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-stone-700">Checklist items</span>
          <button type="button" onClick={addItem} className="text-xs text-amber-600 font-medium">
            + Add item
          </button>
        </div>
        <ul className="space-y-2">
          {items.map((it, i) => {
            const isYes = !it.notApplicable && it.passed === true;
            const isNo = !it.notApplicable && it.passed === false;
            const isNA = it.notApplicable === true;
            const isUntouched = !isYes && !isNo && !isNA;
            return (
              <li
                key={i}
                className={`rounded-lg border bg-white p-3 space-y-2 ${
                  isUntouched ? "border-stone-200 border-l-4 border-l-amber-400" : "border-stone-200"
                }`}
              >
                <div className="flex gap-2 items-start">
                  <input
                    type="text"
                    value={it.label}
                    onChange={(e) => updateItem(i, { label: e.target.value })}
                    placeholder="Item label"
                    className="flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
                  />
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      className="text-stone-400 hover:text-red-500 text-sm min-h-11 min-w-11 flex items-center justify-center"
                      aria-label="Remove"
                    >
                      🗑
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => updateItem(i, { passed: true, notApplicable: false })}
                    className={`text-[14px] font-semibold rounded-full py-3 ${
                      isYes ? "bg-emerald-500 text-white" : "bg-stone-100 text-stone-500"
                    }`}
                    aria-pressed={isYes}
                  >
                    ✓ Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => updateItem(i, { passed: false, notApplicable: false })}
                    className={`text-[14px] font-semibold rounded-full py-3 ${
                      isNo ? "bg-red-500 text-white" : "bg-stone-100 text-stone-500"
                    }`}
                    aria-pressed={isNo}
                  >
                    ✕ No
                  </button>
                  <button
                    type="button"
                    onClick={() => updateItem(i, { passed: null, notApplicable: true })}
                    className={`text-[14px] font-semibold rounded-full py-3 ${
                      isNA ? "bg-stone-700 text-white" : "bg-stone-100 text-stone-500"
                    }`}
                    aria-pressed={isNA}
                    title="Not applicable to this scope"
                  >
                    N/A
                  </button>
                </div>
                {isUntouched && (
                  <p className="text-[11px] text-amber-700">Tap Yes, No or N/A to mark this item.</p>
                )}
                {/* Per-row remark + inline camera (Colab step 6). Always
                    visible — Colab shows the remark field on every row so
                    the reviewer can capture context on Yes rows too
                    (installation notes, batch numbers). Camera is a
                    small icon on the right, styled to match Colab's
                    single-photo affordance. */}
                <div className="flex items-start gap-2">
                  <VoiceTextarea
                    multiline={false}
                    value={it.notes}
                    onChange={(v) => updateItem(i, { notes: v })}
                    placeholder={isNo ? "What's wrong?" : "Remark (optional)"}
                  />
                  <ItemPhotoButton
                    photo={it.photo}
                    existingUrl={it.photoUrl}
                    onPick={(f) => updateItem(i, { photo: f })}
                    onClear={() => updateItem(i, { photo: null, photoUrl: null })}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Whole-checklist photos already saved on this draft. Read-only
          strip so the filler can see what's already there; new photos
          added via the PhotoPicker below append on save. Delete-a-
          saved-photo is a follow-up (needs an InspectionPhoto DELETE
          endpoint). */}
      {existingWholePhotos.length > 0 && (
        <div className="block">
          <span className="text-sm font-medium text-stone-700">
            Already saved <span className="text-stone-400 font-normal">({existingWholePhotos.length})</span>
          </span>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {existingWholePhotos.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className="relative aspect-square rounded-lg border border-stone-200 overflow-hidden bg-stone-50 block"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
              </a>
            ))}
          </div>
          <p className="text-[11px] text-stone-500 mt-1">
            Tap to open. Any new photos below will be added alongside these on save.
          </p>
        </div>
      )}

      <PhotoPicker photos={photos} setPhotos={setPhotos} max={8} label="Extra photos (context / evidence)" />

      {/* Reviewers picker — Colab step 7. Checkbox list of active users
          who can review WIRs. When left empty, the server falls back to
          the role-based broadcast so nothing sits unnoticed. */}
      {reviewers.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-stone-700">
              Reviewers <span className="text-stone-400 font-normal">(optional)</span>
            </span>
            {selectedReviewerIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedReviewerIds(new Set())}
                className="text-[11px] text-stone-500 underline"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-[11px] text-stone-500">
            Pick who should look at this. Leave blank to notify every planner.
          </p>
          <ul className="rounded-lg border border-stone-200 divide-y divide-stone-100 bg-white">
            {reviewers.map((r) => {
              const checked = selectedReviewerIds.has(r.id);
              return (
                <li key={r.id}>
                  <label className="flex items-center gap-3 px-3 py-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleReviewer(r.id)}
                      className="w-5 h-5 accent-ferrous-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-stone-900 truncate">
                        {r.name || r.username}
                      </div>
                      <div className="text-[11px] text-stone-500">
                        {r.role.replace("_", " ").toLowerCase()}
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && <p className="text-[13px] text-ferrous-600">{error}</p>}

      {/* Action row. Fresh WIRs get the full three-button hierarchy
          (Save Draft / Reschedule / Send For Review). Resume-editing a
          draft hides Reschedule — a rescheduled WIR is a distinct
          concept from a saved draft, and "park my in-progress
          checklist for later" is what Save Draft already means. */}
      <div className="space-y-2">
        <button
          type="button"
          disabled={pending}
          onClick={saveDraft}
          className="w-full rounded-full bg-sandstone-100 text-ink py-3 text-[14px] font-semibold disabled:opacity-60"
        >
          {pending ? "Saving…" : isEditingDraft ? "Save Draft (keep editing)" : "Save Draft"}
        </button>
        <div className={isEditingDraft ? "" : "grid grid-cols-2 gap-3"}>
          {!isEditingDraft && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const v = validate();
                if (!v.ok) {
                  setError(v.error);
                  return;
                }
                setError(null);
                setReschedPopupOpen(true);
              }}
              className="rounded-full border border-ink text-ink py-4 text-[15px] font-semibold disabled:opacity-60"
            >
              Reschedule
            </button>
          )}
          <button
            type="submit"
            disabled={pending || untouchedCount > 0}
            className="w-full rounded-full bg-ink text-cream py-4 text-[15px] font-semibold shadow-card disabled:opacity-60 active:scale-[0.99]"
          >
            {pending ? "Sending…" : "Send For Review"}
          </button>
        </div>
      </div>

      {sendPopupOpen && (
        <BottomSheet onClose={() => setSendPopupOpen(false)} title="Send For Review">
          <label className="block">
            <span className="text-sm font-medium text-stone-700">Remark</span>
            <textarea
              value={submitRemark}
              onChange={(e) => setSubmitRemark(e.target.value)}
              placeholder="Any context the reviewer should know…"
              rows={3}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px]"
            />
          </label>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <button
              type="button"
              onClick={() => setSendPopupOpen(false)}
              className="rounded-full bg-stone-200 text-stone-800 py-3 text-[15px] font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => submitForReview(submitRemark)}
              className="rounded-full bg-ink text-cream py-3 text-[15px] font-semibold shadow-card disabled:opacity-60"
            >
              {pending ? "Sending…" : "Send For Review"}
            </button>
          </div>
        </BottomSheet>
      )}

      {reschedPopupOpen && (
        <BottomSheet onClose={() => setReschedPopupOpen(false)} title="Reschedule">
          <label className="block">
            <span className="text-sm font-medium text-stone-700">New date</span>
            <input
              type="date"
              value={reschedDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setReschedDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px]"
            />
          </label>
          <label className="block mt-3">
            <span className="text-sm font-medium text-stone-700">
              Reason <span className="text-stone-400 font-normal">(optional)</span>
            </span>
            <textarea
              value={reschedNote}
              onChange={(e) => setReschedNote(e.target.value)}
              placeholder="e.g. waiting on rebar delivery"
              rows={2}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px]"
            />
          </label>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <button
              type="button"
              onClick={() => setReschedPopupOpen(false)}
              className="rounded-full bg-stone-200 text-stone-800 py-3 text-[15px] font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => submitAndReschedule(reschedDate, reschedNote)}
              className="rounded-full bg-ink text-cream py-3 text-[15px] font-semibold shadow-card disabled:opacity-60"
            >
              {pending ? "Saving…" : "Reschedule"}
            </button>
          </div>
        </BottomSheet>
      )}
    </form>
  );
}

/**
 * Per-row camera icon. When empty, shows a compact Colab-style camera
 * square that opens the OS camera on tap. When a photo is picked, shows
 * the thumbnail with an X to clear it. Kept dead simple — no drag-drop,
 * no multi-file: the whole point of a per-row shot is "one photo of one
 * checkpoint".
 */
function ItemPhotoButton({
  photo,
  existingUrl,
  onPick,
  onClear,
}: {
  photo: File | null;
  // A saved URL carried through from a draft. When a new `photo` isn't
  // picked, this is what gets rendered — the row shows the shot the
  // filler captured last time. New capture overrides on save.
  existingUrl?: string | null;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const previewUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Priority: newly-captured file > existing saved URL > empty
  // (camera button). New capture wins so a retake replaces the old
  // one visibly.
  const rendered = photo && previewUrl ? previewUrl : (existingUrl || null);
  if (rendered) {
    return (
      <div className="relative w-14 h-14 flex-none rounded-lg overflow-hidden border border-stone-300">
        {/* eslint-disable-next-line @next/next/no-img-element -- blob URL or saved URL */}
        <img src={rendered} alt="Checkpoint" className="w-full h-full object-cover" />
        <button
          type="button"
          onClick={onClear}
          className="absolute top-0.5 right-0.5 bg-stone-900/85 text-white rounded-full w-5 h-5 flex items-center justify-center"
          aria-label="Remove photo"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <label className="flex-none w-14 h-14 rounded-lg border-2 border-dashed border-stone-300 flex items-center justify-center text-stone-400 hover:border-stone-500 hover:text-stone-700 cursor-pointer">
      <Camera className="w-5 h-5" />
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const compressed = await compressImage(f);
          onPick(compressed);
          e.target.value = "";
        }}
      />
    </label>
  );
}

/**
 * Reusable bottom-sheet — same pattern as the QuickAddFab, but inline so
 * this form doesn't drag another component into its bundle. Locks page
 * scroll while open and closes on Escape.
 */
function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-stone-900/40" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full rounded-t-2xl bg-cream shadow-card px-5 pt-4 pb-8">
        <div className="mx-auto w-12 h-1 rounded-full bg-stone-300 mb-3" aria-hidden="true" />
        <h2 className="font-serif text-[22px] leading-tight text-ink mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}
