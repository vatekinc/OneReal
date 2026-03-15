import { z } from 'zod';

export const incomeSchema = z.object({
  property_id: z.string().uuid('Select a property'),
  unit_id: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive('Amount must be positive'),
  income_type: z.enum(['rent', 'deposit', 'late_fee', 'other']),
  description: z.string().min(1, 'Description is required'),
  transaction_date: z.string().min(1, 'Date is required'),
});

export type IncomeFormValues = z.infer<typeof incomeSchema>;
