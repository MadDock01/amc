// Grouped bars: monthly revenue vs SMS provider cost (both BDT → one shared axis).
// Server-rendered SVG; each bar has a hover tooltip (<title>) and a data table
// is provided underneath so the numbers never depend on colour alone.

const REVENUE = "#2a78d6"; // categorical slot 1
const COST = "#eb6834"; // categorical slot 2

export interface MonthPoint {
  month: string; // YYYY-MM-DD (first of month)
  revenue: number;
  smsCost: number;
}

const bdt = (n: number) =>
  `৳${n.toLocaleString("en-IN", { maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0, minimumFractionDigits: 0 })}`;
const label = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

function niceMax(v: number) {
  if (v <= 0) return 100;
  if (v < 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

export function RevenueCostChart({ data }: { data: MonthPoint[] }) {
  const W = 640, H = 220, padL = 56, padR = 8, padT = 12, padB = 28;
  const max = niceMax(Math.max(...data.map((d) => Math.max(d.revenue, d.smsCost))));
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const group = plotW / data.length;
  const barW = Math.min(22, (group - 16) / 2);
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);

  // Bar with 4px rounded top, square at the baseline.
  const bar = (x: number, v: number, color: string, tip: string) => {
    const top = y(v), h = padT + plotH - top;
    if (h <= 0) return null;
    const r = Math.min(4, h, barW / 2);
    const d = `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`;
    return (
      <path d={d} fill={color}>
        <title>{tip}</title>
      </path>
    );
  };

  return (
    <figure>
      <div className="mb-2 flex gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: REVENUE }} />Revenue (payments)</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COST }} />SMS provider cost</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Monthly revenue versus SMS cost">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="#64748b">{bdt(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + group * i + group / 2;
          return (
            <g key={d.month}>
              {/* invisible wide hit target for the whole month */}
              <rect x={padL + group * i} y={padT} width={group} height={plotH} fill="transparent">
                <title>{`${label(d.month)} — revenue ${bdt(d.revenue)}, SMS cost ${bdt(d.smsCost)}`}</title>
              </rect>
              {bar(cx - barW - 1, d.revenue, REVENUE, `${label(d.month)} revenue: ${bdt(d.revenue)}`)}
              {bar(cx + 1, d.smsCost, COST, `${label(d.month)} SMS cost: ${bdt(d.smsCost)}`)}
              <text x={cx} y={H - 10} textAnchor="middle" fontSize={10} fill="#64748b">{label(d.month)}</text>
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} stroke="#94a3b8" strokeWidth={1} />
      </svg>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-slate-500">Show table</summary>
        <table className="table mt-2">
          <thead><tr><th>Month</th><th>Revenue</th><th>SMS cost</th><th>Margin</th></tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month}><td>{label(d.month)}</td><td>{bdt(d.revenue)}</td><td>{bdt(d.smsCost)}</td><td>{bdt(d.revenue - d.smsCost)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
