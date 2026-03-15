// Schemas (pure types + zod — safe for both client and server)
export { tenantSchema, type TenantFormValues } from './schemas/tenant-schema';
export { providerSchema, type ProviderFormValues } from './schemas/provider-schema';
export { leaseSchema, type LeaseFormValues } from './schemas/lease-schema';

// Hooks (client-only)
export { useTenants } from './hooks/use-tenants';
export { useTenant } from './hooks/use-tenant';
export { useProviders } from './hooks/use-providers';
export { useProvider } from './hooks/use-provider';
export { useLeases } from './hooks/use-leases';

// Server actions are NOT re-exported from the barrel file to avoid
// mixing 'use client' and 'use server' in one module.
// Import server actions via deep paths:
//   import { createTenant } from '@onereal/contacts/actions/create-tenant';
