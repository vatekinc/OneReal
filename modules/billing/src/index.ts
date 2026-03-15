// Schemas (pure types + zod — safe for both client and server)
export { invoiceSchema, type InvoiceFormValues } from './schemas/invoice-schema';
export { paymentSchema, type PaymentFormValues } from './schemas/payment-schema';

// Hooks (client-only) — added as they are implemented
// export { useInvoices } from './hooks/use-invoices';
// export { usePayments } from './hooks/use-payments';
// export { useInvoiceGenerationPreview } from './hooks/use-invoice-generation-preview';

// Server actions are NOT re-exported from the barrel file to avoid
// mixing 'use client' and 'use server' in one module.
// Import server actions via deep paths:
//   import { createInvoice } from '@onereal/billing/actions/create-invoice';
