import { z } from 'zod';

export const providerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  company_name: z.string().optional().default(''),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional().default(''),
  category: z.enum([
    'plumber', 'electrician', 'hvac', 'general_contractor', 'cleaner',
    'landscaper', 'painter', 'roofer', 'pest_control', 'locksmith',
    'appliance_repair', 'other',
  ]),
  notes: z.string().optional().default(''),
});

export type ProviderFormValues = z.infer<typeof providerSchema>;
