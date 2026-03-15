import { createServerSupabaseClient } from '@onereal/database/server';
import { getProperty } from '@onereal/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@onereal/database';
import { PropertyDetailTabs } from '@/components/properties/property-detail-tabs';
import { Button } from '@onereal/ui';
import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DeletePropertyButton } from '@/components/properties/delete-property-button';

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabaseRaw = await createServerSupabaseClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = supabaseRaw as unknown as SupabaseClient<Database>;

  let property: Awaited<ReturnType<typeof getProperty>> | null = null;
  try {
    property = await getProperty(supabase, id);
  } catch {
    notFound();
  }

  if (!property) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{(property as any).name}</h1>
        <div className="flex gap-2">
          <Link href={`/properties/${id}/edit`}>
            <Button variant="outline" size="sm" className="gap-2">
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          </Link>
          <DeletePropertyButton propertyId={id} />
        </div>
      </div>
      <PropertyDetailTabs
        property={property as any}
        units={(property.units ?? []) as any}
        images={(property.property_images ?? []) as any}
      />
    </div>
  );
}
