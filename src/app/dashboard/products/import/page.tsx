import { requireTenantUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { Importer } from "./importer";

export default async function ImportPage() {
  await requireTenantUser();
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Import products from CSV"
        subtitle="Export your Excel sheet as CSV (File → Save As → CSV UTF-8) and upload it here."
      />
      <Importer />
    </div>
  );
}
