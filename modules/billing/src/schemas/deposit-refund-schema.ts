import { z } from 'zod';

export const depositRefundSchema = z.object({
  lease_id: z.string().uuid('Select a lease'),
  refund_amount: z.coerce.number().positive('Amount must be positive'),
  refund_date: z.string().min(1, 'Refund date is required'),
  payment_method: z.enum(['check', 'ach', 'cash', 'other']),
  reference_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  deduction_expense_ids: z.array(z.string().uuid()).default([]),
  settle_invoice_ids: z.array(z.string().uuid()).default([]),
});

export type DepositRefundFormValues = z.infer<typeof depositRefundSchema>;

export const voidDepositRefundSchema = z.object({
  refund_id: z.string().uuid(),
});
