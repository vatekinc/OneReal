'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useInvoiceGenerationPreview } from '@onereal/billing';
import { generateInvoices } from '@onereal/billing/actions/generate-invoices';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface GenerateInvoicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function GenerateInvoicesDialog({ open, onOpenChange }: GenerateInvoicesDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: preview, isLoading: previewLoading } = useInvoiceGenerationPreview(
    activeOrg?.id ?? null,
    month,
    year,
  );

  async function handleGenerate() {
    if (!activeOrg) return;
    setIsGenerating(true);
    const result = await generateInvoices(activeOrg.id, month, year);
    setIsGenerating(false);

    if (result.success) {
      if (result.data.created > 0) {
        toast.success(`Created ${result.data.created} invoice(s)${result.data.skipped > 0 ? `, ${result.data.skipped} skipped` : ''}`);
      } else if (result.data.skipped > 0) {
        const reason = result.data.skipReasons?.[0] ?? 'Unknown reason';
        toast.error(`Skipped ${result.data.skipped} invoice(s): ${reason}`);
      }
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-generation-preview'] });
      onOpenChange(false);
    } else {
      toast.error(result.error);
    }
  }

  // Build month options: current month +/- a few
  const monthOptions: { month: number; year: number; label: string }[] = [];
  for (let i = -1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    monthOptions.push({
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      label: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
    });
  }

  const selectedKey = `${month}-${year}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Generate Monthly Invoices</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Month</label>
            <Select
              value={selectedKey}
              onValueChange={(v) => {
                const [m, y] = v.split('-').map(Number);
                setMonth(m);
                setYear(y);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map((opt) => (
                  <SelectItem key={`${opt.month}-${opt.year}`} value={`${opt.month}-${opt.year}`}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border bg-muted/50 p-3">
            {previewLoading ? (
              <p className="text-sm text-muted-foreground">Checking active leases...</p>
            ) : preview ? (
              <p className="text-sm text-muted-foreground">
                This will create invoices for <strong className="text-foreground">{preview.eligible} active lease(s)</strong>
                {' '}that don&apos;t have {monthNames[month - 1]} {year} invoices yet.
                {preview.existing > 0 && ` (${preview.existing} already exist)`}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No active leases found.</p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !preview?.eligible}
            >
              {isGenerating ? 'Generating...' : `Generate ${preview?.eligible ?? 0} Invoice(s)`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
