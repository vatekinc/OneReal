import { z } from 'zod';

export const creditSchema = z.object({
  source: z.enum(['manual', 'advance_payment']),
  tenant_id: z.string().uuid('Select a tenant'),
  lease_id: z.string().uuid().optional().nullable(),
  property_id: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive('Amount must be positive'),
  reason: z.string().min(1, 'Reason is required'),
  payment_method: z.string().optional().nullable(),
});

export type CreditFormValues = z.infer<typeof creditSchema>;

export const applyCreditSchema = z.object({
  invoice_id: z.string().uuid(),
  applications: z.array(z.object({
    credit_id: z.string().uuid(),
    amount: z.coerce.number().positive('Amount must be positive'),
  })).min(1, 'Select at least one credit'),
});

export type ApplyCreditFormValues = z.infer<typeof applyCreditSchema>;
