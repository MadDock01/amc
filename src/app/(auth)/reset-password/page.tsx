"use client";
import { useFormState } from "react-dom";
import { updatePassword } from "../actions";
import { SubmitButton } from "@/components/submit-button";

export default function ResetPasswordPage() {
  const [state, action] = useFormState(updatePassword, undefined);
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">Choose a new password</h1>
      <form action={action} className="space-y-4">
        <div>
          <label className="label" htmlFor="password">New password</label>
          <input className="input" id="password" name="password" type="password" minLength={8} autoComplete="new-password" required />
        </div>
        <div>
          <label className="label" htmlFor="confirm">Confirm password</label>
          <input className="input" id="confirm" name="confirm" type="password" minLength={8} autoComplete="new-password" required />
        </div>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <SubmitButton className="btn-primary w-full" pendingText="Saving…">Update password</SubmitButton>
      </form>
    </>
  );
}
