import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, homeFor } from "@/lib/auth";
import { Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { changePassword, updateProfile } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const s = await getSession();
  if (!s) redirect("/login?next=/account");
  const { user, tenant } = s;
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href={homeFor(user.role)} className="text-sm text-indigo-700 hover:underline">← Back</Link>
      <div className="mt-3"><Flash searchParams={searchParams} /></div>
      <PageHeader title="My account" subtitle={`${user.email} · ${user.role}${tenant ? ` · ${tenant.business_name}` : ""}`} />
      <form action={updateProfile} className="card mb-6 grid gap-3 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Profile</h2>
        <div><label className="label">Name</label><input className="input" name="name" defaultValue={user.name ?? ""} required /></div>
        <div><label className="label">Mobile</label><input className="input" name="phone" defaultValue={user.phone ? "0" + user.phone.slice(3) : ""} /></div>
        <div><SubmitButton>Save profile</SubmitButton></div>
      </form>
      <form action={changePassword} className="card grid gap-3 sm:grid-cols-3">
        <h2 className="font-semibold sm:col-span-3">Change password</h2>
        <input className="input" type="password" name="current" placeholder="Current password" autoComplete="current-password" required />
        <input className="input" type="password" name="password" placeholder="New password (8+)" minLength={8} autoComplete="new-password" required />
        <input className="input" type="password" name="confirm" placeholder="Confirm new password" minLength={8} autoComplete="new-password" required />
        <div><SubmitButton>Change password</SubmitButton></div>
      </form>
    </main>
  );
}
