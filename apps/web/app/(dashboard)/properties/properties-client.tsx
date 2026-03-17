'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useProperties } from '@onereal/portfolio';
import { PropertyList } from '@/components/properties/property-list';
import { PropertyCard } from '@/components/properties/property-card';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@onereal/ui';
import { Plus, LayoutGrid, List } from 'lucide-react';
import { deleteProperty } from '@onereal/portfolio/actions/delete-property';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface PropertiesClientProps {
  orgId: string;
}

export function PropertiesClient({ orgId }: PropertiesClientProps) {
  const [view, setView] = useState<'table' | 'grid'>('table');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const queryClient = useQueryClient();

  async function handleDelete(propertyId: string) {
    if (!confirm('Are you sure you want to delete this property? This will also delete all units and images.')) return;
    const result = await deleteProperty(propertyId);
    if (result.success) {
      toast.success('Property deleted');
      queryClient.invalidateQueries({ queryKey: ['properties'] });
    } else {
      toast.error(result.error);
    }
  }

  const { data, isLoading } = useProperties({
    orgId,
    search: search || undefined,
    type: typeFilter || undefined,
    status: statusFilter || undefined,
  });

  const properties = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Properties</h1>
        <Link href="/properties/new">
          <Button className="gap-2"><Plus className="h-4 w-4" /> Add Property</Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search properties..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="single_family">Single Family</SelectItem>
            <SelectItem value="townhouse">Townhouse</SelectItem>
            <SelectItem value="apartment_complex">Apartment Complex</SelectItem>
            <SelectItem value="condo">Condo</SelectItem>
            <SelectItem value="commercial">Commercial</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="sold">Sold</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-1">
          <Button variant={view === 'table' ? 'default' : 'ghost'} size="icon" onClick={() => setView('table')}>
            <List className="h-4 w-4" />
          </Button>
          <Button variant={view === 'grid' ? 'default' : 'ghost'} size="icon" onClick={() => setView('grid')}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : properties.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">No properties yet</p>
          <Link href="/properties/new"><Button>Add your first property</Button></Link>
        </div>
      ) : view === 'table' ? (
        <PropertyList data={properties as any} onDelete={handleDelete} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((p: any) => <PropertyCard key={p.id} property={p} />)}
        </div>
      )}
    </div>
  );
}
