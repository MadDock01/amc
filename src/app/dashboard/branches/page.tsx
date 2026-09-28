import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { hasFeature } from "@/lib/plans";
import { displayPhone } from "@/lib/phone";
import type { Branch } from "@/lib/types";
import { Empty, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createBranch, deleteBranch } from "./actions";

export const dynamic = "force-dynamic";

export default async function BranchesPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const { tenant } = await requireOwner();
  if (!hasFeature(tenant.subscription_plan, "branches")) {
    return <Empty>Multi-branch is available on the Enterprise plan.</Empty>;
  }
  const supabase = createClient();
  const [{ data }, { data: counts }, { data: staff }] = await Promise.all([
    supabase.from("branches").select("*").order("name"),
    supabase.from("products").select("branch_id").not("branch_id", "is", null).limit(100000),
    supabase.from("users").select("branch_id").not("branch_id", "is", null),
  ]);
  const branches = (data ?? []) as Branch[];
  const count = (rows: { branch_id: string | null }[] | null, id: string) => (rows ?? []).filter((r) => r.branch_id === id).length;

  return (
    <div className="max-w-4xl">
      <Flash searchParams={searchParams} />
      <PageHeader title="Branches" subtitle="Assign products and staff to branches. Staff assigned to a branch only see that branch's products." />
      {!branches.length ? <Empty>No branches yet.</Empty> : (
        <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table">
            <thead><tr><th>Name</th><th>Address</th><th>Phone</th><th>Products</th><th>Staff</th><th></th></tr></thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id}>
                  <td className="font-medium">{b.name}</td>
                  <td>{b.address ?? "—"}</td>
                  <td>{displayPhone(b.phone)}</td>
                  <td>{count(counts, b.id)}</td>
                  <td>{count(staff, b.id)}</td>
                  <td>
                    <form action={deleteBranch.bind(null, b.id)}>
                      <SubmitButton className="text-sm text-red-600 hover:underline" pendingText="…" confirm={`Remove branch ${b.name}?`}>Remove</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form action={createBranch} className="card grid gap-3 sm:grid-cols-4">
        <h2 className="font-semibold sm:col-span-4">Add branch</h2>
        <input className="input" name="name" placeholder="Branch name *" required />
        <input className="input" name="address" placeholder="Address" />
        <input className="input" name="phone" placeholder="Phone" />
        <SubmitButton>Add branch</SubmitButton>
      </form>
    </div>
  );
}
