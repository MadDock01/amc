import { requireSuperAdmin } from "@/lib/auth";
import { NavLinks } from "@/components/nav";

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSuperAdmin();
  return (
    <div className="min-h-screen">
      <header className="border-b bg-slate-900 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2">
          <span className="font-semibold">Platform admin</span>
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <span>{user.email}</span>
            <form action="/auth/signout" method="post"><button className="hover:text-white">Log out</button></form>
          </div>
        </div>
      </header>
      <div className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-4 py-2">
          <NavLinks
            links={[
              { href: "/super-admin", label: "Overview" },
              { href: "/super-admin/tenants", label: "Tenants" },
              { href: "/super-admin/tenants/new", label: "Onboard tenant" },
              { href: "/super-admin/health", label: "System health" },
            ]}
          />
        </div>
      </div>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
