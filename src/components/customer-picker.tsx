"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { displayPhone } from "@/lib/phone";

interface Option {
  id: string;
  name: string;
  phone: string | null;
}

/**
 * Autocomplete over the shop's customers (RLS keeps it to this tenant),
 * with a "new customer" mode. Emits either customer_id or new_customer_* fields.
 */
export function CustomerPicker({ initial }: { initial?: Option | null }) {
  const [selected, setSelected] = useState<Option | null>(initial ?? null);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const supabase = useRef(createClient());

  useEffect(() => {
    if (selected || creating) return;
    const q = query.trim();
    const handle = setTimeout(async () => {
      let req = supabase.current.from("customers").select("id, name, phone").order("name").limit(8);
      if (q) {
        const safe = q.replace(/[%,()]/g, " ");
        req = req.or(`name.ilike.%${safe}%,phone.ilike.%${safe.replace(/^0/, "")}%`);
      }
      const { data } = await req;
      setOptions((data as Option[]) ?? []);
    }, 200);
    return () => clearTimeout(handle);
  }, [query, selected, creating]);

  if (creating) {
    return (
      <div className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50/40 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">New customer</span>
          <button type="button" className="text-xs text-indigo-700 hover:underline" onClick={() => setCreating(false)}>
            Pick existing instead
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <input className="input" name="new_customer_name" placeholder="Name *" defaultValue={query} required />
          <input className="input" name="new_customer_phone" placeholder="Mobile 01XXXXXXXXX" />
          <input className="input" name="new_customer_email" type="email" placeholder="Email (optional)" />
        </div>
        <p className="text-xs text-slate-500">If the mobile number already exists, the existing customer is used.</p>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
        <input type="hidden" name="customer_id" value={selected.id} />
        <span>
          <span className="font-medium">{selected.name}</span>
          {selected.phone && <span className="ml-2 text-slate-500">{displayPhone(selected.phone)}</span>}
        </span>
        <button type="button" className="text-xs text-indigo-700 hover:underline" onClick={() => setSelected(null)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        className="input"
        placeholder="Search customer by name or mobile…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setSelected(o)}
              >
                {o.name} <span className="text-slate-500">{o.phone ? displayPhone(o.phone) : ""}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left font-medium text-indigo-700 hover:bg-indigo-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setCreating(true)}
            >
              + Create new customer{query ? ` "${query}"` : ""}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
