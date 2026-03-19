import { z } from 'zod';

export const recurringExpenseSchema = z.object({
  property_id: z.string().uuid('Select a property'),
  unit_id: z.string().uuid().optional().nullable(),
  expense_type: z.enum([
    'mortgage', 'maintenance', 'repairs', 'utilities', 'insurance',
    'taxes', 'management', 'advertising', 'legal', 'hoa', 'home_warranty', 'other',
  ]),
  amount: z.coerce.number().positive('Amount must be positive'),
  frequency: z.enum(['monthly', 'yearly']),
  description: z.string().optional().default(''),
  provider_id: z.string().uuid().optional().nullable(),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().optional().nullable().default(null),
  is_active: z.boolean().optional().default(true),
}).refine(
  (data) => !data.end_date || data.end_date >= data.start_date,
  { message: 'End date must be on or after start date', path: ['end_date'] }
);

export type RecurringExpenseFormValues = z.infer<typeof recurringExpenseSchema>;
