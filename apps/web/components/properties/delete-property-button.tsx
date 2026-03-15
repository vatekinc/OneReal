'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@onereal/ui';
import { Trash2 } from 'lucide-react';
import { deleteProperty } from '@onereal/portfolio/actions/delete-property';
import { toast } from 'sonner';

export function DeletePropertyButton({ propertyId }: { propertyId: string }) {
  const router = useRouter();

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this property? This will also delete all units and images.')) return;
    const result = await deleteProperty(propertyId);
    if (result.success) {
      toast.success('Property deleted');
      router.push('/properties');
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Button variant="outline" size="sm" className="gap-2 text-destructive hover:text-destructive" onClick={handleDelete}>
      <Trash2 className="h-4 w-4" /> Delete
    </Button>
  );
}
