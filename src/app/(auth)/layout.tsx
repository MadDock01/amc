import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 block text-center text-lg font-semibold text-indigo-700">Warranty Reminder</Link>
        <div className="card p-6">{children}</div>
      </div>
    </main>
  );
}
