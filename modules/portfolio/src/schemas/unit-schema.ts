import { z } from 'zod';

export const unitSchema = z.object({
  unit_number: z.string().min(1, 'Unit number is required'),
  type: z.enum(['studio', '1bed', '2bed', '3bed', '4bed', 'commercial_unit', 'residential', 'other']).optional().nullable(),
  bedrooms: z.coerce.number().int().min(0).optional().nullable(),
  bathrooms: z.coerce.number().min(0).optional().nullable(),
  square_feet: z.coerce.number().int().min(0).optional().nullable(),
  rent_amount: z.coerce.number().min(0).optional().nullable(),
  deposit_amount: z.coerce.number().min(0).optional().nullable(),
  status: z.enum(['vacant', 'occupied', 'maintenance', 'not_available']).default('vacant'),
  floor: z.coerce.number().int().optional().nullable(),
});

export type UnitFormValues = z.infer<typeof unitSchema>;
