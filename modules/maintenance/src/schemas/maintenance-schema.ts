import { z } from 'zod';

export const maintenanceRequestSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().optional().default(''),
  category: z.enum([
    'plumbing', 'electrical', 'hvac', 'appliance',
    'structural', 'pest', 'other',
  ]),
  priority: z.enum(['low', 'medium', 'high', 'emergency']),
  unit_id: z.string().uuid('Select a unit'),
});

export type MaintenanceRequestFormValues = z.infer<typeof maintenanceRequestSchema>;

export const maintenanceUpdateSchema = z.object({
  status: z.enum(['open', 'in_progress', 'waiting_parts', 'completed', 'closed']).optional(),
  assigned_to: z.string().uuid().optional().nullable(),
  estimated_cost: z.coerce.number().nonnegative().optional().nullable(),
  actual_cost: z.coerce.number().nonnegative().optional().nullable(),
  scheduled_date: z.string().optional().nullable(),
  completed_date: z.string().optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'emergency']).optional(),
});

export type MaintenanceUpdateFormValues = z.infer<typeof maintenanceUpdateSchema>;
