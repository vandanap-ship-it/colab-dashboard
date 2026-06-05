import { test, expect, signIn, getProjectId, uniqueId } from "./fixtures";

test.describe("Drawing Register", () => {
  test("API: planner adds a drawing, uploads a revision, it becomes current", async ({ page }) => {
    await signIn(page, "planner");
    const projectId = await getProjectId(page);

    const num = `A-${uniqueId().slice(-6)}`;
    const createRes = await page.request.post("/api/drawings", {
      data: {
        projectId,
        drawingNumber: num,
        title: "Earth Bedroom Ground Floor",
        discipline: "ARCHITECTURAL",
      },
    });
    expect(createRes.status()).toBe(201);
    const drawing = (await createRes.json()).drawing;
    expect(drawing.drawingNumber).toBe(num.toUpperCase());
    expect(drawing.discipline).toBe("ARCHITECTURAL");
    expect(drawing.currentRevision).toBeNull();

    // Upload revision R0. fileUrl must be from our /api/upload pipeline —
    // the route allowlists /uploads/... and *.public.blob.vercel-storage.com
    // (see src/lib/upload.ts isOwnUploadUrl).
    const revRes = await page.request.post(`/api/drawings/${drawing.id}/revisions`, {
      data: {
        revisionLabel: "R0",
        fileUrl: `/uploads/drawings-${drawing.id}/A-104-R0.pdf`,
        fileName: "A-104-R0.pdf",
        issuedDate: new Date().toISOString(),
        notes: "Initial issue",
      },
    });
    expect(revRes.status()).toBe(201);

    // The drawing's currentRevision now points at R0.
    const detail = await (await page.request.get(`/api/drawings/${drawing.id}`)).json();
    expect(detail.drawing.currentRevision?.revisionLabel).toBe("R0");
    expect(detail.drawing.revisions).toHaveLength(1);
  });

  test("API: a duplicate drawing number in the same project is rejected", async ({ page }) => {
    await signIn(page, "planner");
    const projectId = await getProjectId(page);
    const num = `S-${uniqueId().slice(-6)}`;
    const first = await page.request.post("/api/drawings", {
      data: { projectId, drawingNumber: num, title: "Footing GA", discipline: "STRUCTURAL" },
    });
    expect(first.ok()).toBeTruthy();
    const dup = await page.request.post("/api/drawings", {
      data: { projectId, drawingNumber: num, title: "Another", discipline: "STRUCTURAL" },
    });
    expect(dup.status()).toBe(400);
  });

  test("API: an engineer can view drawings but cannot add them", async ({ page }) => {
    // First a planner adds one so there's something to view.
    await signIn(page, "planner");
    const projectId = await getProjectId(page);
    await page.request.post("/api/drawings", {
      data: { projectId, drawingNumber: `M-${uniqueId().slice(-6)}`, title: "MEP layout", discipline: "MEP" },
    });

    await page.context().clearCookies();
    await signIn(page, "engineer");

    const list = await page.request.get(`/api/drawings?projectId=${projectId}`);
    expect(list.ok()).toBeTruthy();
    const data = await list.json();
    expect(Array.isArray(data.drawings)).toBeTruthy();

    const add = await page.request.post("/api/drawings", {
      data: { projectId, drawingNumber: "X-1", title: "nope", discipline: "OTHER" },
    });
    expect(add.status()).toBe(403);
  });

  test("API: discipline filter narrows the list", async ({ page }) => {
    await signIn(page, "planner");
    const projectId = await getProjectId(page);
    const archNum = `A-${uniqueId().slice(-6)}`;
    await page.request.post("/api/drawings", {
      data: { projectId, drawingNumber: archNum, title: "Arch", discipline: "ARCHITECTURAL" },
    });

    const arch = await page.request.get(`/api/drawings?projectId=${projectId}&discipline=ARCHITECTURAL`);
    const archData = await arch.json();
    expect(archData.drawings.every((d: { discipline: string }) => d.discipline === "ARCHITECTURAL")).toBeTruthy();

    const struct = await page.request.get(`/api/drawings?projectId=${projectId}&discipline=STRUCTURAL`);
    const structData = await struct.json();
    expect(
      structData.drawings.every((d: { discipline: string }) => d.discipline === "STRUCTURAL"),
    ).toBeTruthy();
  });

  test("UI: planner adds a drawing through the desktop form", async ({ page }) => {
    await signIn(page, "planner");
    const projectId = await getProjectId(page);

    await page.goto(`/projects/${projectId}/drawings`);
    await expect(page.getByRole("heading", { name: /Drawing Register/i })).toBeVisible();

    await page.getByRole("button", { name: /^Add drawing$/i }).first().click();
    const drawingNumber = `A-${uniqueId().slice(-6)}`;
    await page.getByPlaceholder(/e.g. A-104/i).fill(drawingNumber);
    await page.getByPlaceholder(/Earth Bedroom/i).fill(`[E2E UI] Plan ${uniqueId()}`);
    await page.getByRole("button", { name: /^Add drawing$/i }).click();

    // Back in the list, the new drawing appears with its number.
    await expect(page.getByText(drawingNumber.toUpperCase())).toBeVisible();
  });
});
