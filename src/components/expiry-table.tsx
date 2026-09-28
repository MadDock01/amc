import Link from "next/link";
import { daysBetween, expiryTone, formatDate, todayISO } from "@/lib/dates";
import { displayPhone } from "@/lib/phone";
import type { ExpiryRow } from "@/lib/queries";
import type { Followup } from "@/lib/types";
import { OutcomeBadge } from "./outcome";
import { Badge, Empty, toneToBadge } from "./ui";

export function ExpiryTable({ rows, empty, outcomes }: { rows: ExpiryRow[]; empty: string; outcomes?: Map<string, Followup> }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  const today = todayISO();
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Customer</th>
            <th>Type</th>
            <th>Expiry</th>
            <th>Days</th>
            {outcomes && <th>Last follow-up</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const left = daysBetween(today, r.date);
            return (
              <tr key={r.product.id + r.type}>
                <td>
                  <Link href={`/dashboard/products/${r.product.id}`} className="font-medium text-indigo-700 hover:underline">
                    {r.product.product_name}
                  </Link>
                  {r.product.serial_number && <div className="text-xs text-slate-500">SN {r.product.serial_number}</div>}
                </td>
                <td>
                  {r.product.customers?.name}
                  <div className="text-xs text-slate-500">{displayPhone(r.product.customers?.phone)}</div>
                </td>
                <td className="uppercase">{r.type === "amc" ? "AMC" : "Warranty"}</td>
                <td>{formatDate(r.date)}</td>
                <td>
                  <Badge tone={toneToBadge(expiryTone(r.date, today))}>
                    {left < 0 ? `${-left}d overdue` : left === 0 ? "today" : `${left}d`}
                  </Badge>
                </td>
                {outcomes && (
                  <td>{outcomes.get(r.product.id) ? <OutcomeBadge outcome={outcomes.get(r.product.id)!.outcome} /> : <span className="text-slate-400">—</span>}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
