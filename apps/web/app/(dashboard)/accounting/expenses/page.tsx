'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useExpenses } from '@onereal/accounting';
import { useProperties } from '@onereal/portfolio';
import { deleteExpense } from '@onereal/accounting/actions/delete-expense';
import { ExpenseDialog } from '@/components/accounting/expense-dialog';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge,
} from '@onereal/ui';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Expense } from '@onereal/types';

const expenseTypes: Record<string, string> = {
  mortgage: 'Mortgage',
  maintenance: 'Maintenance',
  repairs: 'Repairs',
  utilities: 'Utilities',
  insurance: 'Insurance',
  taxes: 'Taxes',
  management: 'Management',
  advertising: 'Advertising',
  legal: 'Legal',
  hoa: 'HOA',
  home_warranty: 'Home Warranty',
  other: 'Other',
};

export default function ExpensesPage() {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propertiesData?.data ?? []) as any[];

  const { data: expenseData, isLoading } = useExpenses({
    orgId: activeOrg?.id ?? null,
    propertyId: propertyFilter || undefined,
    expenseType: typeFilter || undefined,
    search: search || undefined,
  });

  const expenses = (expenseData ?? []) as Expense[];

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this expense entry?')) return;
    const result = await deleteExpense(id);
    if (result.success) {
      toast.success('Expense deleted');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    } else {
      toast.error(result.error);
    }
  }

  function handleEdit(item: Expense) {
    setEditingExpense(item);
    setDialogOpen(true);
  }

  function handleAdd() {
    setEditingExpense(null);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Expenses</h1>
        <Button className="gap-2" onClick={handleAdd}>
          <Plus className="h-4 w-4" /> Add Expense
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search expenses..."
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
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {Object.entries(expenseTypes).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : expenses.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">No expenses recorded yet</p>
          <Button onClick={handleAdd}>Add your first expense entry</Button>
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
              {expenses.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell>{new Date(item.transaction_date).toLocaleDateString()}</TableCell>
                  <TableCell>{item.properties?.name ?? '\u2014'}</TableCell>
                  <TableCell>{item.units?.unit_number ?? '\u2014'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {item.expense_type.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">{item.description}</TableCell>
                  <TableCell className="text-right font-medium text-red-600">
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

      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expense={editingExpense}
      />
    </div>
  );
}
