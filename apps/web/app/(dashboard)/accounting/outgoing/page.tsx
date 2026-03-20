'use client';

import { useState, useMemo } from 'react';
import { useUser } from '@onereal/auth';
import { useExpenses } from '@onereal/accounting';
import { useProperties } from '@onereal/portfolio';
import { deleteExpense } from '@onereal/accounting/actions/delete-expense';
import { ExpenseDialog } from '@/components/accounting/expense-dialog';
import { GenerateExpensesDialog } from '@/components/accounting/generate-expenses-dialog';
import { resolveDateRange } from '@/lib/date-range';
import {
  Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge,
  cn,
} from '@onereal/ui';
import { Plus, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Expense } from '@onereal/types';

const DATE_RANGES = [
  { value: 'current_month', label: 'This Month' },
  { value: 'current_year', label: 'This Year' },
  { value: '3yr', label: '3yr' },
  { value: '5yr', label: '5yr' },
  { value: 'all', label: 'All Time' },
];

export default function OutgoingPage() {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();

  const [dateRange, setDateRange] = useState('current_month');
  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');

  const resolvedDates = useMemo(() => resolveDateRange(dateRange), [dateRange]);

  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);

  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propertiesData?.data ?? []) as any[];

  const { data: expensesData, isLoading } = useExpenses({
    orgId: activeOrg?.id ?? null,
    propertyId: propertyFilter || undefined,
    search: search || undefined,
    from: resolvedDates?.from,
    to: resolvedDates?.to,
  });
  const expenses = (expensesData ?? []) as any[];

  function handleNewExpense() {
    setEditingExpense(null);
    setExpenseDialogOpen(true);
  }

  function handleEditExpense(expense: Expense) {
    setEditingExpense(expense);
    setExpenseDialogOpen(true);
  }

  async function handleDeleteExpense(id: string) {
    if (!confirm('Delete this expense?')) return;
    const result = await deleteExpense(id);
    if (result.success) {
      toast.success('Expense deleted');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Outgoing</h1>
        <div className="flex items-center gap-4">
          <div className="flex gap-1.5">
            {DATE_RANGES.map((r) => (
              <Button
                key={r.value}
                variant={dateRange === r.value ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setDateRange(r.value)}
                className={cn('text-xs', dateRange !== r.value && 'text-muted-foreground')}
              >
                {r.label}
              </Button>
            ))}
          </div>
          <Button variant="outline" className="gap-2" onClick={() => setGenerateDialogOpen(true)}>
            <RefreshCw className="h-4 w-4" /> Generate
          </Button>
          <Button className="gap-2" onClick={handleNewExpense}>
            <Plus className="h-4 w-4" /> New Expense
          </Button>
        </div>
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
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : expenses.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">No expenses recorded yet</p>
          <Button onClick={handleNewExpense}>Add your first expense</Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((exp: any) => (
                <TableRow key={exp.id}>
                  <TableCell>{new Date(exp.transaction_date).toLocaleDateString()}</TableCell>
                  <TableCell>{exp.properties?.name ?? '\u2014'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{exp.expense_type.replace(/_/g, ' ')}</Badge>
                  </TableCell>
                  <TableCell>{exp.service_providers?.name ?? '\u2014'}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{exp.description}</TableCell>
                  <TableCell className="text-right font-medium text-red-600">
                    ${Number(exp.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleEditExpense(exp)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteExpense(exp.id)}>
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
        open={expenseDialogOpen}
        onOpenChange={setExpenseDialogOpen}
        expense={editingExpense}
      />
      <GenerateExpensesDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
      />
    </div>
  );
}
