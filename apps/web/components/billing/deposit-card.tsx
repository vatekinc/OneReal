'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useDepositRefunds, useDepositSummary } from '@onereal/billing';
import { voidDepositRefund } from '@onereal/billing/actions/void-deposit-refund';
import { Button, Badge } from '@onereal/ui';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { DepositRefundDialog } from './deposit-refund-dialog';

interface DepositCardProps {
  leaseId: string;
  leaseLabel: string;
  /** When true, renders a single-line button (used on tenant-page lease rows). */
  compact?: boolean;
}

export function DepositCard({ leaseId, leaseLabel, compact }: DepositCardProps) {
  const { activeOrg } = useUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: summary } = useDepositSummary(activeOrg?.id ?? null, leaseId);
  const { data: refunds = [] } = useDepositRefunds({
    orgId: activeOrg?.id ?? null,
    leaseId,
  });

  const held = Number(summary?.held ?? 0);
  const refunded = Number(summary?.refunded ?? 0);
  const withheld = Number(summary?.withheld ?? 0);
  const balance = Number(summary?.balance ?? 0);

  async function handleVoid(refundId: string, refundNumber: string) {
    if (!activeOrg) return;
    if (
      !confirm(
        `Void refund ${refundNumber}? The paired expense will be deleted and any linked deductions freed.`,
      )
    )
      return;
    const result = await voidDepositRefund(activeOrg.id, refundId);
    if (result.success) {
      toast.success('Refund voided');
      queryClient.invalidateQueries({ queryKey: ['deposit-refunds'] });
      queryClient.invalidateQueries({ queryKey: ['deposit-summary'] });
      queryClient.invalidateQueries({ queryKey: ['deposit-eligible-deductions'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
    } else {
      toast.error(result.error);
    }
  }

  const hasDeposit = held > 0;
  const refundDisabledReason = !hasDeposit
    ? 'No deposit on this lease'
    : balance <= 0
      ? 'Deposit fully accounted for'
      : null;

  if (compact) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          disabled={!!refundDisabledReason}
          title={refundDisabledReason ?? 'Refund deposit'}
          onClick={() => setOpen(true)}
        >
          Refund deposit (${balance.toFixed(0)})
        </Button>
        <DepositRefundDialog
          open={open}
          onOpenChange={setOpen}
          leaseId={leaseId}
          leaseLabel={leaseLabel}
        />
      </>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Deposit</h3>
        <Button
          size="sm"
          className="gap-2"
          disabled={!!refundDisabledReason}
          title={refundDisabledReason ?? undefined}
          onClick={() => setOpen(true)}
        >
          <Plus className="h-4 w-4" /> Refund Deposit
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-2 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Held</div>
          <div className="font-medium">${held.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Refunded</div>
          <div className="font-medium">${refunded.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Withheld</div>
          <div className="font-medium">${withheld.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Balance</div>
          <div className="font-medium">${balance.toFixed(2)}</div>
        </div>
      </div>

      {(refunds as any[]).length > 0 && (
        <div className="border-t pt-3">
          <h4 className="text-xs font-semibold text-muted-foreground mb-2">Refunds</h4>
          <ul className="space-y-2">
            {(refunds as any[]).map((r: any) => (
              <li key={r.id} className="text-sm rounded border p-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.refund_number}</span>
                    <Badge variant={r.status === 'active' ? 'default' : 'secondary'}>
                      {r.status}
                    </Badge>
                    <span className="text-muted-foreground">{r.refund_date}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium">${Number(r.refund_amount).toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground capitalize">{r.payment_method}</span>
                    {r.status === 'active' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleVoid(r.id, r.refund_number)}
                      >
                        Void
                      </Button>
                    )}
                  </div>
                </div>
                {r.deductions?.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Deductions:{' '}
                    {r.deductions
                      .map(
                        (d: any) =>
                          `${d.expense?.description || d.expense?.expense_type} $${Number(
                            d.expense?.amount || 0,
                          ).toFixed(2)}`,
                      )
                      .join(', ')}
                  </div>
                )}
                {r.settlements?.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Settled invoices:{' '}
                    {r.settlements
                      .map(
                        (s: any) =>
                          `${s.invoice?.invoice_number ?? ''} ${s.invoice?.description ?? ''} $${Number(
                            s.amount || 0,
                          ).toFixed(2)}`,
                      )
                      .join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <DepositRefundDialog
        open={open}
        onOpenChange={setOpen}
        leaseId={leaseId}
        leaseLabel={leaseLabel}
      />
    </div>
  );
}
