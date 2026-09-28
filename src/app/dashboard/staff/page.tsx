import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/dates";
import { PLANS } from "@/lib/plans";
import type { AppUser } from "@/lib/types";
import { Badge, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { addStaff, removeStaff } from "./actions";

export const dynamic = "force-dynamic";

export default async function StaffPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const { tenant, user: me } = await requireOwner();
  const { data } = await createClient().from("users").select("*").order("created_at");
  const users = (data ?? []) as AppUser[];
  const max = PLANS[tenant.subscription_plan].maxStaff;

  return (
    <div className="max-w-4xl">
      <Flash searchParams={searchParams} />
      <PageHeader
        title="Staff"
        subtitle={`Staff can add and edit products and customers. They cannot delete records or see billing. ${max === null ? "Unlimited staff." : `Your plan allows ${max} staff.`}`}
      />
      <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th><th></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name ?? "—"}{u.id === me.id && <span className="ml-1 text-xs text-slate-500">(you)</span>}</td>
                <td>{u.email}</td>
                <td><Badge tone={u.role === "owner" ? "blue" : "slate"}>{u.role}</Badge></td>
                <td>{formatDateTime(u.last_login)}</td>
                <td>
                  {u.role === "staff" && (
                    <form action={removeStaff.bind(null, u.id)}>
                      <SubmitButton className="text-sm text-red-600 hover:underline" pendingText="Removing…" confirm={`Remove ${u.name ?? u.email}? They will lose access immediately.`}>
                        Remove
                      </SubmitButton>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form action={addStaff} className="card grid gap-3 sm:grid-cols-4">
        <h2 className="font-semibold sm:col-span-4">Add staff member</h2>
        <input className="input" name="name" placeholder="Name" required />
        <input className="input" name="email" type="email" placeholder="Email (login)" required />
        <input className="input" name="password" type="text" minLength={8} placeholder="Temporary password" required />
        <SubmitButton pendingText="Creating…">Add staff</SubmitButton>
      </form>
    </div>
  );
}
