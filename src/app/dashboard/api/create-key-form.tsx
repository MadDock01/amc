"use client";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/submit-button";
import { createApiKey } from "./actions";

export function CreateKeyForm() {
  const [state, action] = useFormState(createApiKey, undefined);
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Create API key</h2>
      <form action={action} className="flex flex-wrap gap-2">
        <input className="input max-w-xs" name="name" placeholder="Key name, e.g. POS integration" required />
        <SubmitButton pendingText="Creating…">Create key</SubmitButton>
      </form>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.key && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <div className="font-medium">Copy this key now — it won&apos;t be shown again.</div>
          <code className="mt-1 block break-all rounded bg-white p-2 font-mono text-xs" data-testid="new-api-key">{state.key}</code>
        </div>
      )}
    </div>
  );
}
