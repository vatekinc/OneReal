import { z } from 'zod';

export const paymentSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.coerce.number().positive('Amount must be positive'),
  payment_date: z.string().min(1, 'Payment date is required'),
  payment_method: z.enum(['cash', 'check', 'bank_transfer', 'online', 'other']),
  reference_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type PaymentFormValues = z.infer<typeof paymentSchema>;
