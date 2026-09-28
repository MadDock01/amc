"use client";
import { useFormState } from "react-dom";
import { signup } from "../actions";
import { SubmitButton } from "@/components/submit-button";

export function SignupForm() {
  const [state, action] = useFormState(signup, undefined);
  if (state?.message) return <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{state.message}</p>;
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="business_name">Business name</label>
        <input className="input" id="business_name" name="business_name" required />
      </div>
      <div>
        <label className="label" htmlFor="business_type">Business type</label>
        <select className="input" id="business_type" name="business_type" defaultValue="electronics">
          <option value="electronics">Electronics dealer</option>
          <option value="amc">AMC / service provider</option>
          <option value="generator_solar">Generator / solar installer</option>
          <option value="insurance">Insurance agent</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input className="input" id="name" name="name" required />
        </div>
        <div>
          <label className="label" htmlFor="phone">Mobile</label>
          <input className="input" id="phone" name="phone" placeholder="01XXXXXXXXX" required />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input className="input" id="password" name="password" type="password" minLength={8} autoComplete="new-password" required />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <SubmitButton className="btn-primary w-full" pendingText="Creating account…">Create account</SubmitButton>
    </form>
  );
}
