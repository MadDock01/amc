import { requireOwner } from "@/lib/auth";
import { Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { REMINDER_DAY_OPTIONS } from "@/lib/plans";
import { saveSettings } from "./actions";

export default async function SettingsPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const { tenant } = await requireOwner();
  return (
    <div className="max-w-3xl">
      <Flash searchParams={searchParams} />
      <PageHeader title="Settings" />
      <form action={saveSettings} className="space-y-6">
        <section className="card grid gap-3 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Business</h2>
          <div><label className="label">Business name</label><input className="input" name="business_name" defaultValue={tenant.business_name} required /></div>
          <div><label className="label">Business type</label><input className="input" name="business_type" defaultValue={tenant.business_type ?? ""} /></div>
          <div><label className="label">Shop mobile (shown in customer SMS)</label><input className="input" name="phone" defaultValue={tenant.phone ? "0" + tenant.phone.slice(3) : ""} /></div>
          <div><label className="label">Address</label><input className="input" name="address" defaultValue={tenant.address ?? ""} /></div>
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Reminders</h2>
          <div>
            <span className="label">Send reminders this many days before expiry</span>
            <div className="flex flex-wrap gap-3">
              {REMINDER_DAY_OPTIONS.map((d) => (
                <label key={d} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="reminder_days" value={d} defaultChecked={tenant.reminder_days.includes(d)} /> {d}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="sms_language">SMS language</label>
            <select className="input w-auto" id="sms_language" name="sms_language" defaultValue={tenant.sms_language}>
              <option value="en">English (cheaper: 160 characters per SMS)</option>
              <option value="bn">বাংলা (70 characters per SMS — uses more credits)</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="notify_owner_email" defaultChecked={tenant.notify_owner_email} /> Email me a copy of every reminder
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="notify_owner_sms" defaultChecked={tenant.notify_owner_sms} /> SMS me a copy of every reminder (uses SMS credits)
          </label>
        </section>
        <SubmitButton>Save settings</SubmitButton>
      </form>
    </div>
  );
}
