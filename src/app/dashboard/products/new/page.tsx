import Link from "next/link";
import { requireTenantUser } from "@/lib/auth";
import { assignableBranches } from "@/lib/branches";
import { todayISO } from "@/lib/dates";
import { ProductForm } from "@/components/product-form";
import { Flash, PageHeader } from "@/components/ui";
import { createProduct } from "../actions";

export default async function NewProductPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const { tenant, user } = await requireTenantUser();
  const branches = await assignableBranches(tenant, user);
  return (
    <div className="max-w-3xl">
      <Flash searchParams={searchParams} />
      <PageHeader title="Add product" actions={<Link href="/dashboard/products/import" className="btn-secondary">Import many from CSV</Link>} />
      <div className="card p-6">
        <ProductForm action={createProduct} today={todayISO()} branches={branches} />
      </div>
    </div>
  );
}
