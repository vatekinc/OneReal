'use client';

import { useState } from 'react';
import { useTenantCreditBalance, useCredits } from '@onereal/billing';
import { useUser } from '@onereal/auth';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@onereal/ui';
import { CreditCard, Plus } from 'lucide-react';
import Link from 'next/link';
import { CreditDialog } from '@/components/billing/credit-dialog';

const sourceLabels: Record<string, string> = {
  manual: 'Manual',
  overpayment: 'Overpayment',
  advance_payment: 'Advance',
};

interface TenantCreditWidgetProps {
  tenantId: string;
}

export function TenantCreditWidget({ tenantId }: TenantCreditWidgetProps) {
  const { activeOrg } = useUser();
  const { data: balance } = useTenantCreditBalance(activeOrg?.id ?? null, tenantId);
  const { data: credits } = useCredits({
    orgId: activeOrg?.id ?? null,
    tenantId,
    status: 'active',
  });

  const [creditDialogOpen, setCreditDialogOpen] = useState(false);

  const activeCredits = (credits ?? []).filter((c: any) =>
    Number(c.amount) - Number(c.amount_used) > 0
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4" /> Credits
          </CardTitle>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setCreditDialogOpen(true)}>
            <Plus className="h-3 w-3" /> New Credit
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <p className="text-2xl font-bold">
              ${Number(balance?.available_balance ?? 0).toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              Available balance ({balance?.active_count ?? 0} active credit{(balance?.active_count ?? 0) !== 1 ? 's' : ''})
            </p>
          </div>

          {activeCredits.length > 0 && (
            <div className="space-y-2">
              {activeCredits.slice(0, 3).map((credit: any) => {
                const remaining = Number(credit.amount) - Number(credit.amount_used);
                return (
                  <div key={credit.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{sourceLabels[credit.source]}</Badge>
                      <span className="text-muted-foreground truncate max-w-[150px]">{credit.reason}</span>
                    </div>
                    <span className="font-medium">${remaining.toFixed(2)}</span>
                  </div>
                );
              })}
              {activeCredits.length > 3 && (
                <Link href={`/accounting/credits?tenant=${tenantId}`} className="text-xs text-primary hover:underline">
                  View all {activeCredits.length} credits &rarr;
                </Link>
              )}
            </div>
          )}

          {activeCredits.length === 0 && (
            <p className="text-sm text-muted-foreground">No active credits</p>
          )}
        </CardContent>
      </Card>

      <CreditDialog
        open={creditDialogOpen}
        onOpenChange={setCreditDialogOpen}
        defaultTenantId={tenantId}
      />
    </>
  );
}
