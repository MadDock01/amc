"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normalizeBdPhone } from "@/lib/phone";
import { redirectWith } from "@/lib/redirect";

export async function updateProfile(fd: FormData) {
  const s = await getSession();
  if (!s) redirectWith("/login", {});
  const parsed = z.object({ name: z.string().trim().min(1).max(200), phone: z.string().trim().optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) redirectWith("/account", { error: "Name is required" });
  const phone = parsed.data.phone ? normalizeBdPhone(parsed.data.phone) : null;
  if (parsed.data.phone && !phone) redirectWith("/account", { error: "Enter a valid Bangladeshi mobile number" });
  const { error } = await createClient().from("users").update({ name: parsed.data.name, phone }).eq("id", s!.user.id);
  if (error) redirectWith("/account", { error: error.message });
  revalidatePath("/", "layout");
  redirectWith("/account", { ok: "Profile saved." });
}

export async function changePassword(fd: FormData) {
  const s = await getSession();
  if (!s) redirectWith("/login", {});
  const parsed = z
    .object({ current: z.string().min(1), password: z.string().min(8), confirm: z.string() })
    .refine((d) => d.password === d.confirm)
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) redirectWith("/account", { error: "New passwords must match and be at least 8 characters." });
  const supabase = createClient();
  // Re-authenticate so a hijacked session can't silently change the password.
  const { error: authErr } = await supabase.auth.signInWithPassword({ email: s!.user.email ?? "", password: parsed.data.current });
  if (authErr) redirectWith("/account", { error: "Current password is incorrect." });
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) redirectWith("/account", { error: error.message });
  redirectWith("/account", { ok: "Password changed." });
}
