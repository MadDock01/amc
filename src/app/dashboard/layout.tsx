import Link from "next/link";
import { requireTenantUser, tenantIsActive } from "@/lib/auth";
import { NavLinks } from "@/components/nav";
import { PLANS } from "@/lib/plans";
import { formatDate } from "@/lib/dates";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, tenant } = await requireTenantUser();
  const isOwner = user.role === "owner";
  const links = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/products", label: "Products" },
    { href: "/dashboard/customers", label: "Customers" },
    { href: "/dashboard/reminders", label: "Reminders" },
    { href: "/dashboard/reports", label: "Reports" },
    ...(isOwner
      ? [
          { href: "/dashboard/staff", label: "Staff" },
          { href: "/dashboard/billing", label: "Billing" },
          { href: "/dashboard/settings", label: "Settings" },
        ]
      : []),
  ];
  const active = tenantIsActive(tenant);
  const trialDaysLeft = Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86_400_000);

  return (
    <div className="min-h-screen">
      <header className="no-print border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="font-semibold text-indigo-700">{tenant.business_name}</Link>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{PLANS[tenant.subscription_plan].name}</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{user.name ?? user.email} · {user.role}</span>
            <form action="/auth/signout" method="post">
              <button className="text-slate-500 hover:text-slate-900">Log out</button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 pb-2">
          <NavLinks links={links} />
        </div>
      </header>
      {!active ? (
        <div className="no-print bg-red-600 px-4 py-2 text-center text-sm text-white">
          Your {tenant.subscription_plan === "trial" ? "trial" : "subscription"} has ended — reminders are paused and you can&apos;t add products.{" "}
          {isOwner ? <Link href="/dashboard/billing" className="font-semibold underline">Renew now</Link> : "Ask the shop owner to renew."}
        </div>
      ) : tenant.subscription_plan === "trial" ? (
        <div className="no-print bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          Free trial: {trialDaysLeft} day(s) left (ends {formatDate(tenant.trial_ends_at)}).{" "}
          {isOwner && <Link href="/dashboard/billing" className="font-semibold underline">Choose a plan</Link>}
        </div>
      ) : null}
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
