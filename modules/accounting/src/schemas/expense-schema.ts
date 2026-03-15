import { z } from 'zod';

export const expenseSchema = z.object({
  property_id: z.string().uuid('Select a property'),
  unit_id: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive('Amount must be positive'),
  expense_type: z.enum([
    'mortgage', 'maintenance', 'repairs', 'utilities', 'insurance',
    'taxes', 'management', 'advertising', 'legal', 'hoa', 'home_warranty', 'other',
  ]),
  description: z.string().optional().default(''),
  transaction_date: z.string().min(1, 'Date is required'),
  provider_id: z.string().uuid().optional().nullable(),
});

export type ExpenseFormValues = z.infer<typeof expenseSchema>;
