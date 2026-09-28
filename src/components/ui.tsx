import Link from "next/link";
import type { ExpiryTone } from "@/lib/dates";

export function Badge({ tone = "slate", children }: { tone?: "slate" | "green" | "yellow" | "red" | "blue" | "gray"; children: React.ReactNode }) {
  const cls = {
    slate: "bg-slate-100 text-slate-700",
    gray: "bg-slate-100 text-slate-500",
    green: "bg-emerald-100 text-emerald-800",
    yellow: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-indigo-100 text-indigo-800",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export function toneToBadge(t: ExpiryTone) {
  return ({ expired: "gray", red: "red", yellow: "yellow", green: "green", none: "slate" } as const)[t];
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "sent" || status === "active" || status === "ok"
      ? "green"
      : status === "failed" || status === "error" || status === "expired"
        ? "red"
        : status === "pending" || status === "running"
          ? "yellow"
          : "gray";
  return <Badge tone={tone}>{status}</Badge>;
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: string; href?: string; tone?: "red" | "yellow" }) {
  const color = tone === "red" ? "text-red-600" : tone === "yellow" ? "text-amber-600" : "text-slate-900";
  const body = (
    <div className="card h-full">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

export function Flash({ searchParams }: { searchParams?: { error?: string; ok?: string } }) {
  if (searchParams?.error)
    return <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{searchParams.error}</div>;
  if (searchParams?.ok)
    return <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{searchParams.ok}</div>;
  return null;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>;
}

export function PageHeader({ title, actions, subtitle }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
