'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useCredits } from '@onereal/billing';
import { useProperties } from '@onereal/portfolio';
import { useTenants } from '@onereal/contacts';
import { voidCredit } from '@onereal/billing/actions/void-credit';
import { CreditTable } from '@/components/billing/credit-table';
import { CreditDialog } from '@/components/billing/credit-dialog';
import {
  Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Tabs, TabsList, TabsTrigger,
} from '@onereal/ui';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

type TabValue = 'active' | 'fully_applied' | 'void' | 'all';

export default function CreditsPage() {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<TabValue>('active');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);

  const { data: propertiesData } = useProperties({ orgId: activeOrg?.id ?? null });
  const properties = (propertiesData?.data ?? []) as any[];
  const { data: tenantsData } = useTenants({ orgId: activeOrg?.id ?? null });
  const tenants = (tenantsData ?? []) as any[];

  const statusFilter = tab === 'all' ? 'all' : tab;

  const { data: credits, isLoading } = useCredits({
    orgId: activeOrg?.id ?? null,
    propertyId: propertyFilter || undefined,
    tenantId: tenantFilter || undefined,
    status: statusFilter,
    source: sourceFilter || undefined,
  });

  async function handleVoid(credit: any) {
    if (!activeOrg) return;
    if (!confirm('Void this credit? Remaining balance will be forfeited.')) return;
    const result = await voidCredit(credit.id, activeOrg.id);
    if (result.success) {
      toast.success('Credit voided');
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
    } else {
      toast.error(result.error);
    }
  }

  function handleApply(_credit: any) {
    toast.info('Use "Apply Credit" from the invoice row in Incoming to apply credits.');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Credits</h1>
        <Button className="gap-2" onClick={() => setCreditDialogOpen(true)}>
          <Plus className="h-4 w-4" /> New Credit
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="fully_applied">Applied</TabsTrigger>
          <TabsTrigger value="void">Void</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={tenantFilter} onValueChange={(v) => setTenantFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Tenants" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tenants</SelectItem>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.first_name} {t.last_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={propertyFilter} onValueChange={(v) => setPropertyFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Properties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Properties</SelectItem>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Sources" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="overpayment">Overpayment</SelectItem>
            <SelectItem value="advance_payment">Advance Payment</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (credits ?? []).length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">No credits found</p>
          <Button onClick={() => setCreditDialogOpen(true)}>Create your first credit</Button>
        </div>
      ) : (
        <CreditTable credits={credits ?? []} onVoid={handleVoid} onApply={handleApply} />
      )}

      <CreditDialog open={creditDialogOpen} onOpenChange={setCreditDialogOpen} />
    </div>
  );
}
