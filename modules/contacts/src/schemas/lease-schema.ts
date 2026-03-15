import { z } from 'zod';

export const leaseSchema = z.object({
  property_id: z.string().uuid('Select a property'),
  unit_id: z.string().uuid('Select a unit'),
  tenant_id: z.string().uuid('Select a tenant'),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().min(1, 'End date is required'),
  rent_amount: z.coerce.number().positive('Rent must be positive'),
  deposit_amount: z.coerce.number().min(0).optional().default(0),
  payment_due_day: z.coerce.number().min(1).max(28).optional().default(1),
  status: z.enum(['draft', 'active', 'expired', 'terminated']).default('draft'),
}).refine((data) => data.end_date > data.start_date, {
  message: 'End date must be after start date',
  path: ['end_date'],
});

export type LeaseFormValues = z.infer<typeof leaseSchema>;
