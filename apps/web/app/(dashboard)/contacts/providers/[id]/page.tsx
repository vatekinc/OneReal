'use client';

import { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@onereal/auth';
import { useProvider } from '@onereal/contacts';
import { useExpenses } from '@onereal/accounting';
import { ProviderDialog } from '@/components/contacts/provider-dialog';
import { DateRangeFilterClient, type DateRangeValue } from '@/components/accounting/date-range-filter-client';
import {
  Button, Card, CardContent, CardHeader, CardTitle, Badge,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@onereal/ui';
import { ArrowLeft, Pencil, Mail, Phone, Building2 } from 'lucide-react';

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

export default function ProviderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { activeOrg } = useUser();

  const { data: provider, isLoading } = useProvider(id);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeValue>({});

  const handleDateRangeChange = useCallback((value: DateRangeValue) => {
    setDateRange(value);
  }, []);

  const { data: expensesData } = useExpenses({
    orgId: activeOrg?.id ?? null,
    providerId: id,
    from: dateRange.from,
    to: dateRange.to,
  });
  const expenses = (expensesData ?? []) as any[];

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading...</p>;
  if (!provider) return <p className="text-sm text-muted-foreground p-4">Provider not found</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/contacts/providers')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold">{provider.name}</h1>
        <Badge variant="secondary">
          {providerCategoryLabels[provider.category] ?? provider.category}
        </Badge>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Contact Information</CardTitle>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setEditDialogOpen(true)}>
            <Pencil className="h-4 w-4" /> Edit
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {provider.company_name && (
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span>{provider.company_name}</span>
              </div>
            )}
            {provider.email && (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{provider.email}</span>
              </div>
            )}
            {provider.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{provider.phone}</span>
              </div>
            )}
          </div>
          {provider.notes && (
            <p className="mt-4 text-sm text-muted-foreground">{provider.notes}</p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Work History</h2>
        <DateRangeFilterClient onChange={handleDateRangeChange} />

        {expenses.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center">
            <p className="text-muted-foreground">No work history found for this provider</p>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((expense: any) => (
                  <TableRow key={expense.id}>
                    <TableCell>{new Date(expense.transaction_date).toLocaleDateString()}</TableCell>
                    <TableCell>{expense.properties?.name ?? '\u2014'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {expense.expense_type.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">{expense.description}</TableCell>
                    <TableCell className="text-right font-medium text-red-600">
                      ${Number(expense.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ProviderDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        provider={provider}
      />
    </div>
  );
}
