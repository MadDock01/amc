import Link from "next/link";
import { SignupForm } from "./form";

export default function SignupPage() {
  return (
    <>
      <h1 className="text-lg font-semibold">Start your 14-day free trial</h1>
      <p className="mb-4 mt-1 text-sm text-slate-500">No payment needed. Up to 25 products during trial.</p>
      <SignupForm />
      <p className="mt-4 text-center text-sm text-slate-600">
        Already have an account? <Link href="/login" className="text-indigo-600 hover:underline">Log in</Link>
      </p>
    </>
  );
}
