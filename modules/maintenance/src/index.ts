// Schemas
export { maintenanceRequestSchema, type MaintenanceRequestFormValues } from './schemas/maintenance-schema';
export { maintenanceUpdateSchema, type MaintenanceUpdateFormValues } from './schemas/maintenance-schema';

// Hooks (client-only)
export { useMaintenanceRequests, type MaintenanceFilters } from './hooks/use-maintenance-requests';
export { useTenantMaintenanceRequests } from './hooks/use-tenant-maintenance-requests';

// Server actions: use deep imports
// import { createMaintenanceRequest } from '@onereal/maintenance/actions/create-maintenance-request';
// import { updateMaintenanceRequest } from '@onereal/maintenance/actions/update-maintenance-request';
export { useMaintenanceActivity, type MaintenanceActivity } from './hooks/use-maintenance-activity';
// import { addMaintenanceNote } from '@onereal/maintenance/actions/add-maintenance-note';
// import { deleteMaintenanceNote } from '@onereal/maintenance/actions/delete-maintenance-note';
