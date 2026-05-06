"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function updateOwnName(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Not signed in." };

  const raw = (formData.get("name") ?? "").toString();
  const name = raw.trim();
  if (name.length < 2) return { ok: false, error: "Name must be at least 2 characters." };
  if (name.length > 80) return { ok: false, error: "Name is too long." };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name },
  });

  revalidatePath("/profile");
  return { ok: true };
}

export async function changeOwnPassword(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Not signed in." };

  const current = (formData.get("current") ?? "").toString();
  const next = (formData.get("next") ?? "").toString();
  const confirm = (formData.get("confirm") ?? "").toString();

  if (!current) return { ok: false, error: "Enter your current password." };
  if (next.length < 6) return { ok: false, error: "New password must be at least 6 characters." };
  if (next !== confirm) return { ok: false, error: "New passwords don't match." };
  if (current === next) return { ok: false, error: "New password must differ from current." };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true },
  });
  if (!user) return { ok: false, error: "User not found." };

  const valid = await bcrypt.compare(current, user.passwordHash);
  if (!valid) return { ok: false, error: "Current password is incorrect." };

  const newHash = await bcrypt.hash(next, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });

  return { ok: true };
}
