'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useProviders } from '@onereal/contacts';
import { deleteProvider } from '@onereal/contacts/actions/delete-provider';
import { ProviderDialog } from '@/components/contacts/provider-dialog';
import {
  Button, Input,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge,
} from '@onereal/ui';
import { Plus, Pencil, Trash2, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { ServiceProvider } from '@onereal/types';

const providerCategoryLabels: Record<string, string> = {
  plumber: 'Plumber',
  electrician: 'Electrician',
  hvac: 'HVAC',
  general_contractor: 'General Contractor',
  cleaner: 'Cleaner',
  landscaper: 'Landscaper',
  painter: 'Painter',
  roofer: 'Roofer',
  pest_control: 'Pest Control',
  locksmith: 'Locksmith',
  appliance_repair: 'Appliance Repair',
  other: 'Other',
};

export default function ProvidersPage() {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ServiceProvider | null>(null);

  const { data: providersData, isLoading } = useProviders({
    orgId: activeOrg?.id ?? null,
    search: search || undefined,
    category: categoryFilter || undefined,
  });

  const providers = (providersData ?? []) as ServiceProvider[];

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this service provider?')) return;
    const result = await deleteProvider(id);
    if (result.success) {
      toast.success('Provider deleted');
      queryClient.invalidateQueries({ queryKey: ['providers'] });
    } else {
      toast.error(result.error);
    }
  }

  function handleEdit(provider: ServiceProvider) {
    setEditingProvider(provider);
    setDialogOpen(true);
  }

  function handleAdd() {
    setEditingProvider(null);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Service Providers</h1>
        <Button className="gap-2" onClick={handleAdd}>
          <Plus className="h-4 w-4" /> Add Provider
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search providers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {Object.entries(providerCategoryLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : providers.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">No service providers yet</p>
          <Button onClick={handleAdd}>Add your first provider</Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((provider: any) => (
                <TableRow key={provider.id}>
                  <TableCell className="font-medium">{provider.name}</TableCell>
                  <TableCell>{provider.company_name ?? '\u2014'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {providerCategoryLabels[provider.category] ?? provider.category}
                    </Badge>
                  </TableCell>
                  <TableCell>{provider.email ?? '\u2014'}</TableCell>
                  <TableCell>{provider.phone ?? '\u2014'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => router.push(`/contacts/providers/${provider.id}`)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(provider)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(provider.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        provider={editingProvider}
      />
    </div>
  );
}
