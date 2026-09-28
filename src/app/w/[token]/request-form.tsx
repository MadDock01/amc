"use client";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/submit-button";
import { requestRenewal } from "./actions";

export function RequestForm({ token }: { token: string }) {
  const [state, action] = useFormState(requestRenewal.bind(null, token), undefined);
  if (state?.ok) return <p className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{state.ok}</p>;
  return (
    <form action={action} className="mt-4 space-y-2 border-t pt-4">
      <div className="text-sm font-medium">Want to renew? Ask the shop to call you</div>
      <input className="input" name="callback_phone" placeholder="Your mobile (optional) 01XXXXXXXXX" />
      <textarea className="input" name="message" rows={2} maxLength={500} placeholder="Message (optional)" />
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <SubmitButton className="btn-secondary w-full" pendingText="Sending…">Request a renewal call</SubmitButton>
    </form>
  );
}
