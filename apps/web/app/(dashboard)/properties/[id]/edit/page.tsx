'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useProperty, type PropertyFormValues } from '@onereal/portfolio';
import { updateProperty } from '@onereal/portfolio/actions/update-property';
import { PropertyForm } from '@/components/properties/property-form';
import { toast } from 'sonner';

export default function EditPropertyPage() {
  const { id } = useParams<{ id: string }>();
  const { data: property, isLoading } = useProperty(id);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;
  if (!property) return <p className="text-destructive">Property not found</p>;

  async function handleSubmit(values: PropertyFormValues) {
    setLoading(true);
    const result = await updateProperty(id, values);
    if (result.success) {
      toast.success('Property updated!');
      router.push(`/properties/${id}`);
    } else {
      toast.error(result.error);
    }
    setLoading(false);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Edit Property</h1>
      <PropertyForm
        defaultValues={property as any}
        onSubmit={handleSubmit}
        loading={loading}
        submitLabel="Save Changes"
      />
    </div>
  );
}
