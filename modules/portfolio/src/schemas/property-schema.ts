import { z } from 'zod';

export const propertySchema = z.object({
  name: z.string().min(1, 'Property name is required'),
  type: z.enum(['single_family', 'townhouse', 'apartment_complex', 'condo', 'commercial', 'other']),
  status: z.enum(['active', 'inactive', 'sold']).default('active'),
  address_line1: z.string().optional().default(''),
  address_line2: z.string().optional().default(''),
  city: z.string().optional().default(''),
  state: z.string().optional().default(''),
  zip: z.string().optional().default(''),
  country: z.string().default('US'),
  year_built: z.coerce.number().int().min(1800).max(2100).optional().nullable(),
  purchase_price: z.coerce.number().min(0).optional().nullable(),
  purchase_date: z.string().optional().nullable(),
  market_value: z.coerce.number().min(0).optional().nullable(),
  notes: z.string().optional().default(''),
});

export type PropertyFormValues = z.infer<typeof propertySchema>;
