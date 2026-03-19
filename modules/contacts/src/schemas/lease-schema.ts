import { z } from 'zod';

export const leaseSchema = z.object({
  property_id: z.string().uuid('Select a property'),
  unit_id: z.string().uuid('Select a unit'),
  tenant_ids: z.array(z.string().uuid()).min(1, 'Select at least one tenant'),
  lease_type: z.enum(['fixed', 'month_to_month']).default('fixed'),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().optional().default(''),
  rent_amount: z.coerce.number().positive('Rent must be positive'),
  deposit_amount: z.coerce.number().min(0).optional().default(0),
  payment_due_day: z.coerce.number().min(1).max(28).optional().default(1),
  status: z.enum(['draft', 'active', 'expired', 'terminated']).default('draft'),
  late_fee_type: z.enum(['flat', 'percentage']).nullable().optional().default(null),
  late_fee_amount: z.coerce.number().positive().nullable().optional().default(null),
  late_fee_grace_days: z.coerce.number().int().min(1).nullable().optional().default(null),
}).superRefine((data, ctx) => {
  if (data.lease_type === 'fixed') {
    if (!data.end_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End date is required for fixed leases',
        path: ['end_date'],
      });
    } else if (data.end_date <= data.start_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End date must be after start date',
        path: ['end_date'],
      });
    }
  }
});

export type LeaseFormValues = z.infer<typeof leaseSchema>;
