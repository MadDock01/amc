"use client";
import { useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { IMPORT_COLUMNS, normalizeHeader, validateRow, type ImportColumn, type RawRow } from "@/lib/csv";
import { importChunk, type ImportResult } from "./actions";

const CHUNK = 100;
const TEMPLATE =
  IMPORT_COLUMNS.join(",") +
  "\r\nAbdul Karim,01711234567,karim@example.com,Walton AC 1.5 ton,AC,WAC12345,15/01/2026,12,,12,Installed at home\r\n" +
  "Rahima Begum,01811234567,,Samsung TV 43in,TV,,2026-02-01,24,,,\r\n";

export function Importer() {
  const [rows, setRows] = useState<{ line: number; raw: RawRow; error?: string }[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  function onFile(file: File) {
    setResults(null);
    setFileError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const headers = res.meta.fields ?? [];
        const map = new Map<string, ImportColumn>();
        const missing: string[] = [];
        headers.forEach((h) => {
          const c = normalizeHeader(h);
          if (c) map.set(h, c);
          else missing.push(h);
        });
        if (![...map.values()].includes("product_name") || ![...map.values()].includes("customer_name")) {
          setFileError("The file needs at least customer_name, product_name and purchase_date columns. Download the template below.");
          setRows([]);
          return;
        }
        setUnmapped(missing);
        setRows(
          res.data.map((r, i) => {
            const raw: RawRow = {};
            for (const [h, c] of map) raw[c] = r[h];
            return { line: i + 2, raw, error: validateRow(raw).error };
          }),
        );
      },
      error: (e) => setFileError(e.message),
    });
  }

  async function runImport() {
    const valid = rows.filter((r) => !r.error).map(({ line, raw }) => ({ line, raw }));
    const all: ImportResult[] = rows.filter((r) => r.error).map((r) => ({ line: r.line, ok: false, error: r.error }));
    setProgress(0);
    for (let i = 0; i < valid.length; i += CHUNK) {
      try {
        all.push(...(await importChunk(valid.slice(i, i + CHUNK))));
      } catch (e) {
        valid.slice(i, i + CHUNK).forEach((r) => all.push({ line: r.line, ok: false, error: (e as Error).message }));
      }
      setProgress(Math.min(valid.length, i + CHUNK));
      if (all.some((r) => r.error?.startsWith("skipped:"))) break;
    }
    setResults(all.sort((a, b) => a.line - b.line));
    setProgress(null);
  }

  const invalid = rows.filter((r) => r.error).length;
  const imported = results?.filter((r) => r.ok).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <p className="text-xs text-slate-500">
          Columns: <code>{IMPORT_COLUMNS.join(", ")}</code>. Dates can be DD/MM/YYYY or YYYY-MM-DD. Durations accept
          &quot;12&quot;, &quot;12 months&quot; or &quot;1 year&quot;. Customers are matched by mobile number, so repeat customers are not duplicated.
        </p>
        <a
          className="text-sm text-indigo-700 hover:underline"
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
          download="warranty-import-template.csv"
        >
          Download template CSV
        </a>
        {fileError && <p className="text-sm text-red-600">{fileError}</p>}
        {unmapped.length > 0 && <p className="text-xs text-amber-700">Ignored columns: {unmapped.join(", ")}</p>}
      </div>

      {rows.length > 0 && !results && (
        <div className="card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              {rows.length} rows · <span className="text-emerald-700">{rows.length - invalid} valid</span>
              {invalid > 0 && <span className="text-red-700"> · {invalid} with errors (will be skipped)</span>}
            </span>
            <button className="btn-primary" disabled={progress !== null || rows.length === invalid} onClick={runImport}>
              {progress !== null ? `Importing… ${progress}/${rows.length - invalid}` : `Import ${rows.length - invalid} products`}
            </button>
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Product</th>
                  <th>Purchase</th>
                  <th>Warranty</th>
                  <th>AMC</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r) => (
                  <tr key={r.line} className={r.error ? "bg-red-50" : ""}>
                    <td>{r.line}</td>
                    <td>{r.raw.customer_name}</td>
                    <td>{r.raw.customer_phone}</td>
                    <td>{r.raw.product_name}</td>
                    <td>{r.raw.purchase_date}</td>
                    <td>{r.raw.warranty_months}</td>
                    <td>{r.raw.amc_months}</td>
                    <td className="text-xs">{r.error ? <span className="text-red-700">{r.error}</span> : "✓"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 500 && <p className="p-2 text-xs text-slate-500">Showing first 500 rows.</p>}
          </div>
        </div>
      )}

      {results && (
        <div className="card">
          <p className="mb-3 text-sm">
            <span className="font-semibold text-emerald-700">{imported} imported</span>
            {results.length - imported > 0 && <span className="text-red-700"> · {results.length - imported} failed</span>}
            {" · "}
            <Link href="/dashboard/products" className="text-indigo-700 hover:underline">View products</Link>
          </p>
          {results.some((r) => !r.ok) && (
            <ul className="max-h-72 space-y-1 overflow-auto text-xs text-red-700">
              {results.filter((r) => !r.ok).map((r) => (
                <li key={r.line}>Line {r.line}: {r.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
