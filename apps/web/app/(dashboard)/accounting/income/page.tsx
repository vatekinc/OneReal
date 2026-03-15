'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useIncome } from '@onereal/accounting';
import { useProperties } from '@onereal/portfolio';
import { deleteIncome } from '@onereal/accounting/actions/delete-income';
import { IncomeDialog } from '@/components/accounting/income-dialog';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge,
} from '@onereal/ui';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Income } from '@onereal/types';

export default function IncomePage() {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);

  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = propertiesData?.data ?? [];

  const { data: incomeData, isLoading } = useIncome({
    orgId: activeOrg?.id ?? null,
    propertyId: propertyFilter || undefined,
    incomeType: typeFilter || undefined,
    search: search || undefined,
  });

  const income = (incomeData ?? []) as Income[];

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this income entry?')) return;
    const result = await deleteIncome(id);
    if (result.success) {
      toast.success('Income deleted');
      queryClient.invalidateQueries({ queryKey: ['income'] });
    } else {
      toast.error(result.error);
    }
  }

  function handleEdit(item: Income) {
    setEditingIncome(item);
    setDialogOpen(true);
  }

  function handleAdd() {
    setEditingIncome(null);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Income</h1>
        <Button className="gap-2" onClick={handleAdd}>
          <Plus className="h-4 w-4" /> Add Income
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search income..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={propertyFilter} onValueChange={(v) => setPropertyFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Properties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Properties</SelectItem>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="rent">Rent</SelectItem>
            <SelectItem value="deposit">Deposit</SelectItem>
            <SelectItem value="late_fee">Late Fee</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : income.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">No income recorded yet</p>
          <Button onClick={handleAdd}>Add your first income entry</Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {income.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell>{new Date(item.transaction_date).toLocaleDateString()}</TableCell>
                  <TableCell>{item.properties?.name ?? '\u2014'}</TableCell>
                  <TableCell>{item.units?.unit_number ?? '\u2014'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {item.income_type.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">{item.description}</TableCell>
                  <TableCell className="text-right font-medium text-green-600">
                    ${Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(item)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)}>
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

      <IncomeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        income={editingIncome}
      />
    </div>
  );
}
