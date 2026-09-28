import { Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createTenant } from "../../actions";

export default function NewTenantPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  return (
    <div className="max-w-2xl">
      <Flash searchParams={searchParams} />
      <PageHeader title="Onboard a tenant" subtitle="Create a shop and its owner login by hand (e.g. after an in-person demo)." />
      <form action={createTenant} className="card grid gap-3 sm:grid-cols-2">
        <div><label className="label">Business name *</label><input className="input" name="business_name" required /></div>
        <div><label className="label">Business type</label><input className="input" name="business_type" placeholder="electronics / amc / solar…" /></div>
        <div><label className="label">Owner name *</label><input className="input" name="owner_name" required /></div>
        <div><label className="label">Owner mobile</label><input className="input" name="phone" placeholder="01XXXXXXXXX" /></div>
        <div><label className="label">Owner email (login) *</label><input className="input" name="email" type="email" required /></div>
        <div><label className="label">Temporary password *</label><input className="input" name="password" minLength={8} required /></div>
        <div><label className="label">Trial length (days)</label><input className="input" name="trial_days" type="number" min={1} max={365} defaultValue={14} /></div>
        <div className="flex items-end"><SubmitButton pendingText="Creating…">Create tenant</SubmitButton></div>
      </form>
    </div>
  );
}
