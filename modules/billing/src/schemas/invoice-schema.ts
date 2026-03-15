import { z } from 'zod';

export const invoiceSchema = z.object({
  direction: z.enum(['receivable', 'payable']),
  tenant_id: z.string().uuid().optional().nullable(),
  provider_id: z.string().uuid().optional().nullable(),
  property_id: z.string().uuid('Select a property'),
  unit_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  due_date: z.string().min(1, 'Due date is required'),
  issued_date: z.string().optional(),
});

export type InvoiceFormValues = z.infer<typeof invoiceSchema>;
