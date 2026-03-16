export { createClient } from './client';
export type { Database } from './types';

// Query helpers
export * from './queries/organizations';
export * from './queries/profiles';
export * from './queries/properties';
export * from './queries/units';
export * from './queries/financial';
export * from './queries/plans';

// Server-only export is at @onereal/database/server
// import { createServerSupabaseClient } from '@onereal/database/server';
