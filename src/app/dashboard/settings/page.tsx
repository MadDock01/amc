import { requireOwner } from "@/lib/auth";
import { Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { hasFeature, REMINDER_DAY_OPTIONS } from "@/lib/plans";
import { TemplateEditor } from "@/components/template-editor";
import { displayPhone } from "@/lib/phone";
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
          {hasFeature(tenant.subscription_plan, "whatsapp") ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="whatsapp_enabled" defaultChecked={tenant.whatsapp_enabled} /> Also send reminders on WhatsApp (1 credit per message)
            </label>
          ) : (
            <p className="text-sm text-slate-500">WhatsApp reminders are available on the Pro plan.</p>
          )}
          <div className="max-w-xs">
            <label className="label" htmlFor="sms_daily_cap">Maximum SMS parts per day</label>
            <input className="input" id="sms_daily_cap" name="sms_daily_cap" type="number" min={1} max={1000} defaultValue={Math.min(1000, tenant.sms_daily_cap)} />
            <p className="mt-1 text-xs text-slate-500">Protects your credits after a big import. Reminders over the limit go out the next morning.</p>
          </div>
        </section>
        <section className="card">
          <h2 className="mb-2 font-semibold">SMS message</h2>
          <TemplateEditor initial={tenant.sms_template} shop={tenant.business_name} phone={tenant.phone ? displayPhone(tenant.phone).replace("-", "") : ""} />
        </section>
        <SubmitButton>Save settings</SubmitButton>
      </form>
    </div>
  );
}
