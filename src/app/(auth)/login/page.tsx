import Link from "next/link";
import { LoginForm } from "./form";

export default function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">Log in</h1>
      {searchParams.error && <p className="mb-3 text-sm text-red-600">{searchParams.error === "no-tenant" ? "Your account isn't linked to a shop." : searchParams.error}</p>}
      <LoginForm next={searchParams.next} />
      <p className="mt-3 text-center text-sm"><Link href="/forgot-password" className="text-slate-500 hover:underline">Forgot password?</Link></p>
      <p className="mt-2 text-center text-sm text-slate-600">
        New here? <Link href="/signup" className="text-indigo-600 hover:underline">Start a free trial</Link>
      </p>
    </>
  );
}
