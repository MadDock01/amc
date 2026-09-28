"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { homeFor } from "@/lib/auth";
import { normalizeBdPhone } from "@/lib/phone";

export type AuthState = { error?: string; message?: string } | undefined;

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
  next: z.string().optional(),
});

export async function login(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error || !data.user) return { error: error?.message ?? "Login failed" };

  const { data: profile } = await supabase.from("users").select("role").eq("id", data.user.id).single();
  const home = homeFor(profile?.role ?? "owner");
  const next = parsed.data.next;
  // only follow same-site relative paths that belong to the user's area
  redirect(next && next.startsWith(home) && !next.startsWith("//") ? next : home);
}

const signupSchema = z.object({
  business_name: z.string().trim().min(2, "Business name is required").max(200),
  business_type: z.string().trim().max(100).optional(),
  name: z.string().trim().min(2, "Your name is required").max(200),
  phone: z.string().trim().refine((v) => normalizeBdPhone(v) !== null, "Enter a valid Bangladeshi mobile number"),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function signup(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const supabase = createClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? headers().get("origin") ?? "";
  // The DB trigger handle_new_auth_user() creates the tenant, owner row,
  // 14-day trial and trial SMS credits from this metadata.
  const { data, error } = await supabase.auth.signUp({
    email: d.email,
    password: d.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      data: { business_name: d.business_name, business_type: d.business_type, name: d.name, phone: normalizeBdPhone(d.phone) },
    },
  });
  if (error) return { error: error.message };
  if (!data.session) {
    return { message: "Check your email to confirm your account, then log in." };
  }
  redirect("/dashboard?ok=" + encodeURIComponent("Welcome! Your 14-day free trial has started."));
}
