import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/dates";
import { PLANS } from "@/lib/plans";
import type { AppUser } from "@/lib/types";
import { Badge, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { addStaff, assignBranch, removeStaff } from "./actions";
import { hasFeature } from "@/lib/plans";
import type { Branch } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StaffPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const { tenant, user: me } = await requireOwner();
  const multiBranch = hasFeature(tenant.subscription_plan, "branches");
  const [{ data }, { data: branchData }] = await Promise.all([
    createClient().from("users").select("*").order("created_at"),
    multiBranch ? createClient().from("branches").select("*").order("name") : Promise.resolve({ data: [] }),
  ]);
  const users = (data ?? []) as AppUser[];
  const branches = (branchData ?? []) as Branch[];
  const branchSelect = (name: string, value?: string | null) => (
    <select className="input" name={name} defaultValue={value ?? ""}>
      <option value="">All branches</option>
      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
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
            <tr><th>Name</th><th>Email</th><th>Role</th>{branches.length > 0 && <th>Branch</th>}<th>Last login</th><th></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name ?? "—"}{u.id === me.id && <span className="ml-1 text-xs text-slate-500">(you)</span>}</td>
                <td>{u.email}</td>
                <td><Badge tone={u.role === "owner" ? "blue" : "slate"}>{u.role}</Badge></td>
                {branches.length > 0 && (
                  <td>
                    {u.role === "staff" ? (
                      <form action={assignBranch.bind(null, u.id)} className="flex gap-1">
                        {branchSelect("branch_id", u.branch_id)}
                        <SubmitButton className="btn-secondary" pendingText="…">Set</SubmitButton>
                      </form>
                    ) : "All"}
                  </td>
                )}
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
      <form action={addStaff} className={`card grid gap-3 ${branches.length ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
        <h2 className={`font-semibold ${branches.length ? "sm:col-span-5" : "sm:col-span-4"}`}>Add staff member</h2>
        <input className="input" name="name" placeholder="Name" required />
        <input className="input" name="email" type="email" placeholder="Email (login)" required />
        <input className="input" name="password" type="text" minLength={8} placeholder="Temporary password" required />
        {branches.length > 0 && branchSelect("branch_id")}
        <SubmitButton pendingText="Creating…">Add staff</SubmitButton>
      </form>
    </div>
  );
}
