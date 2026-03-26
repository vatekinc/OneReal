'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useCredits } from '@onereal/billing';
import { applyCredits } from '@onereal/billing/actions/apply-credit';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Button, Badge, Input, Checkbox,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Invoice } from '@onereal/types';

const sourceLabels: Record<string, string> = {
  manual: 'Manual',
  overpayment: 'Overpayment',
  advance_payment: 'Advance',
};

interface ApplyCreditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}

export function ApplyCreditDialog({ open, onOpenChange, invoice }: ApplyCreditDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();

  const { data: creditsRaw } = useCredits({
    orgId: activeOrg?.id ?? null,
    tenantId: invoice?.tenant_id ?? undefined,
    status: 'active',
  });

  // Filter by lease scope: show tenant-scoped (no lease_id) + matching lease_id
  const availableCredits = (creditsRaw ?? []).filter((c: any) => {
    if (Number(c.amount) - Number(c.amount_used) <= 0) return false;
    if (!c.lease_id) return true; // tenant-scoped
    return c.lease_id === invoice?.lease_id; // lease-scoped must match
  });

  const invoiceRemaining = invoice ? Number(invoice.amount) - Number(invoice.amount_paid) : 0;

  const [selections, setSelections] = useState<Record<string, number>>({});

  function toggleCredit(creditId: string, creditRemaining: number) {
    setSelections((prev) => {
      if (prev[creditId] !== undefined) {
        const next = { ...prev };
        delete next[creditId];
        return next;
      }
      return { ...prev, [creditId]: Math.min(creditRemaining, invoiceRemaining - totalSelected(prev)) };
    });
  }

  function updateAmount(creditId: string, amount: number) {
    setSelections((prev) => ({ ...prev, [creditId]: amount }));
  }

  function totalSelected(sels: Record<string, number> = selections) {
    return Object.values(sels).reduce((sum, v) => sum + v, 0);
  }

  async function handleApply() {
    if (!activeOrg || !invoice) return;

    const applications = Object.entries(selections)
      .filter(([, amount]) => amount > 0)
      .map(([credit_id, amount]) => ({ credit_id, amount }));

    if (applications.length === 0) {
      toast.error('Select at least one credit to apply');
      return;
    }

    const result = await applyCredits(activeOrg.id, {
      invoice_id: invoice.id,
      applications,
    });

    if (result.success) {
      toast.success(`$${totalSelected().toFixed(2)} credit applied`);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
      queryClient.invalidateQueries({ queryKey: ['credit-applications'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
      setSelections({});
      onOpenChange(false);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setSelections({}); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply Credit</DialogTitle>
          {invoice && (
            <DialogDescription>
              {invoice.invoice_number} — Remaining: ${invoiceRemaining.toFixed(2)}
            </DialogDescription>
          )}
        </DialogHeader>

        {availableCredits.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No credits available for this tenant.</p>
        ) : (
          <div className="space-y-3 max-h-[300px] overflow-y-auto">
            {availableCredits.map((credit: any) => {
              const remaining = Number(credit.amount) - Number(credit.amount_used);
              const isSelected = selections[credit.id] !== undefined;
              return (
                <div key={credit.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleCredit(credit.id, remaining)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{sourceLabels[credit.source]}</Badge>
                      <span className="text-sm font-medium">${remaining.toFixed(2)} available</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{credit.reason}</p>
                  </div>
                  {isSelected && (
                    <Input
                      type="number"
                      step="0.01"
                      min={0.01}
                      max={Math.min(remaining, invoiceRemaining)}
                      value={selections[credit.id]}
                      onChange={(e) => updateAmount(credit.id, Number(e.target.value))}
                      className="w-24"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {availableCredits.length > 0 && (
          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-sm font-medium">
              Total: ${totalSelected().toFixed(2)} of ${invoiceRemaining.toFixed(2)}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setSelections({}); onOpenChange(false); }}>Cancel</Button>
              <Button onClick={handleApply} disabled={totalSelected() <= 0 || totalSelected() > invoiceRemaining}>
                Apply Credit
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
