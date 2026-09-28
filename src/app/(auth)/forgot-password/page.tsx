"use client";
import Link from "next/link";
import { useFormState } from "react-dom";
import { requestPasswordReset } from "../actions";
import { SubmitButton } from "@/components/submit-button";

export default function ForgotPasswordPage() {
  const [state, action] = useFormState(requestPasswordReset, undefined);
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">Reset your password</h1>
      {state?.message ? (
        <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{state.message}</p>
      ) : (
        <form action={action} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input className="input" id="email" name="email" type="email" required />
          </div>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          <SubmitButton className="btn-primary w-full" pendingText="Sending…">Send reset link</SubmitButton>
        </form>
      )}
      <p className="mt-4 text-center text-sm"><Link href="/login" className="text-indigo-600 hover:underline">Back to login</Link></p>
    </>
  );
}
