import { z } from 'zod';

export const leaseChargeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  frequency: z.enum(['monthly', 'yearly', 'one_time']),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().optional().default(''),
  is_active: z.boolean().optional().default(true),
}).refine(
  (data) => !data.end_date || data.end_date >= data.start_date,
  { message: 'End date must be on or after start date', path: ['end_date'] }
);

export type LeaseChargeFormValues = z.infer<typeof leaseChargeSchema>;
