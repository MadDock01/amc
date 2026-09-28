"use client";
import { useState } from "react";
import { renderTemplate, TEMPLATE_VARS, DEFAULT_TEMPLATE_EN, validateTemplate } from "@/lib/notify/templates";
import { smsSegments } from "@/lib/notify/segments";

const SAMPLE = {
  customer: "Abdul Karim",
  product: "Walton AC 1.5 ton",
  type: "warranty",
  date: "09 Oct 2026",
  days: "10",
  when: "on 09 Oct 2026",
  link: "https://app.example.com/w/C14q4SQ7Ss6Ut9u3ZiIBrg",
};

export function TemplateEditor({ initial, shop, phone }: { initial: string | null; shop: string; phone: string }) {
  const [value, setValue] = useState(initial ?? "");
  const effective = value.trim() || DEFAULT_TEMPLATE_EN;
  const preview = renderTemplate(effective, { ...SAMPLE, shop, phone });
  const parts = smsSegments(preview);
  const error = value.trim() ? validateTemplate(value.trim()) : null;

  return (
    <div className="space-y-2">
      <label className="label" htmlFor="sms_template">Custom SMS text (optional)</label>
      <textarea
        className="input font-mono"
        id="sms_template"
        name="sms_template"
        rows={3}
        maxLength={480}
        value={value}
        placeholder={DEFAULT_TEMPLATE_EN}
        onChange={(e) => setValue(e.target.value)}
      />
      <p className="text-xs text-slate-500">
        Placeholders: {[...TEMPLATE_VARS, "when"].map((v) => `{${v}}`).join(" ")}. Leave empty to use the default
        (English or Bangla, following the SMS language setting).
      </p>
      <div className="rounded-md bg-slate-50 p-3 text-sm">
        <div className="mb-1 text-xs font-medium uppercase text-slate-500">Preview</div>
        <div>{preview}</div>
        <div className={`mt-1 text-xs ${parts > 1 ? "text-amber-700" : "text-slate-500"}`}>
          {preview.length} characters · {parts} SMS part{parts > 1 ? "s" : ""} per message{parts > 1 ? " — each part uses a credit" : ""}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
