import Link from "next/link";
import { PLANS } from "@/lib/plans";
import type { Plan } from "@/lib/types";

export default function Home() {
  return (
    <main>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="font-semibold text-indigo-700">Warranty Reminder</span>
          <nav className="flex gap-2">
            <Link href="/login" className="btn-secondary">Log in</Link>
            <Link href="/signup" className="btn-primary">Start free trial</Link>
          </nav>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-slate-900">
          Never miss a warranty or AMC renewal again.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-600">
          Electronics dealers, AMC providers, generator &amp; solar installers: record what you sold, and we automatically
          SMS and email your customers — and you — 30, 15, 7 and 1 day before the warranty or AMC runs out.
          Every reminder is a renewal sale.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/signup" className="btn-primary px-5 py-3 text-base">Start 14-day free trial</Link>
        </div>
        <ul className="mt-12 grid gap-4 sm:grid-cols-3">
          {[
            ["Bulk import", "Upload your old Excel sheet as CSV and you're live in minutes."],
            ["Automatic SMS & email", "Daily reminders via Bangladeshi SMS gateways, with retries."],
            ["Staff accounts", "Staff can add entries; only owners can delete or see billing."],
          ].map(([t, d]) => (
            <li key={t} className="card">
              <div className="font-medium">{t}</div>
              <div className="mt-1 text-sm text-slate-600">{d}</div>
            </li>
          ))}
        </ul>
      </section>
      <section className="border-t bg-white">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <h2 className="text-2xl font-semibold">Pricing</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(PLANS) as Plan[]).map((k) => (
              <div key={k} className="card">
                <div className="font-medium">{PLANS[k].name}</div>
                <div className="mt-2 text-2xl font-bold">
                  {PLANS[k].priceBdt === null ? "Custom" : PLANS[k].priceBdt === 0 ? "Free" : `৳${PLANS[k].priceBdt}/mo`}
                </div>
                <div className="mt-2 text-sm text-slate-600">{PLANS[k].blurb}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
