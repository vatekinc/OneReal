// Schemas (pure types + zod — safe for both client and server)
export { propertySchema, type PropertyFormValues } from './schemas/property-schema';
export { unitSchema, type UnitFormValues } from './schemas/unit-schema';

// Hooks (client-only)
export { useProperties } from './hooks/use-properties';
export { useProperty } from './hooks/use-property';
export { useUnits } from './hooks/use-units';
export { usePropertyImages } from './hooks/use-property-images';

// Server actions are NOT re-exported from the barrel file to avoid
// mixing 'use client' and 'use server' in one module.
// Import server actions via deep paths:
//   import { createProperty } from '@onereal/portfolio/actions/create-property';
