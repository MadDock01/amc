import "server-only";
import { toCsv } from "./csv";
import { monthRangePublic } from "./month";

export function csvResponse(filename: string, headers: string[], rows: unknown[][]) {
  // BOM so Excel opens UTF-8 (Bangla names) correctly
  return new Response("﻿" + toCsv(headers, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

/** Validate ?month=YYYY-MM and return its first/last day. */
export function monthRange(month: string | null): { from: string; to: string } | null {
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  return monthRangePublic(month);
}
