'use client';

import { useState } from 'react';
import { useUser } from '@onereal/auth';
import { useExpenseGenerationPreview } from '@onereal/accounting';
import { generateExpenses } from '@onereal/accounting/actions/generate-expenses';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Button,
} from '@onereal/ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface GenerateExpensesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function GenerateExpensesDialog({ open, onOpenChange }: GenerateExpensesDialogProps) {
  const queryClient = useQueryClient();
  const { activeOrg } = useUser();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: preview, isLoading: previewLoading } = useExpenseGenerationPreview(
    activeOrg?.id ?? null,
    month,
    year,
  );

  async function handleGenerate() {
    if (!activeOrg) return;
    setIsGenerating(true);
    const result = await generateExpenses(activeOrg.id, month, year);
    setIsGenerating(false);

    if (result.success) {
      const { generated, skipped } = result.data;
      if (generated > 0) {
        let msg = `Generated ${generated} bill(s)`;
        if (skipped > 0) msg += ` (${skipped} already existed)`;
        toast.success(msg);
      } else if (skipped > 0) {
        toast.info(`All ${skipped} bill(s) already exist for this month`);
      } else {
        toast.info('No recurring expenses to generate');
      }
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['financial-stats'] });
      queryClient.invalidateQueries({ queryKey: ['expense-generation-preview'] });
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
          <DialogTitle>Generate Monthly Bills</DialogTitle>
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
              <p className="text-sm text-muted-foreground">Checking recurring expenses...</p>
            ) : preview ? (
              <p className="text-sm text-muted-foreground">
                This will create bills for <strong className="text-foreground">{preview.eligible} active recurring expense(s)</strong> that
                don&apos;t have {monthNames[month - 1]} {year} bills yet.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No recurring expenses configured.</p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !preview?.eligible}
            >
              {isGenerating
                ? 'Generating...'
                : `Generate ${preview?.eligible ?? 0} Bill(s)`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
