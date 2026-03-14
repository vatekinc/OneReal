'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@onereal/auth';
import { type PropertyFormValues } from '@onereal/portfolio';
import { createProperty } from '@onereal/portfolio/actions/create-property';
import { PropertyForm } from '@/components/properties/property-form';
import { toast } from 'sonner';

export default function NewPropertyPage() {
  const [loading, setLoading] = useState(false);
  const { activeOrg } = useUser();
  const router = useRouter();

  async function handleSubmit(values: PropertyFormValues) {
    if (!activeOrg) return;
    setLoading(true);

    const result = await createProperty(activeOrg.id, values);

    if (result.success) {
      toast.success('Property created!');
      router.push(`/properties/${result.data.id}`);
    } else {
      toast.error(result.error);
    }
    setLoading(false);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">New Property</h1>
      <PropertyForm onSubmit={handleSubmit} loading={loading} submitLabel="Create Property" />
    </div>
  );
}
