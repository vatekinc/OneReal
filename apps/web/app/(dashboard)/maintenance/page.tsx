import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { getAuthContext } from '@/lib/auth';
import { getProperties } from '@onereal/database';
import { MaintenanceClient } from './maintenance-client';

export default async function MaintenancePage() {
  const auth = await getAuthContext();
  if (!auth) return null;

  const queryClient = new QueryClient();

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ['maintenance-requests', { orgId: auth.orgId }],
      queryFn: async () => {
        const { data, error } = await (auth.supabase as any)
          .from('maintenance_requests')
          .select('*, units(unit_number, property_id, properties(name))')
          .eq('org_id', auth.orgId)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return data ?? [];
      },
    }),
    queryClient.prefetchQuery({
      queryKey: ['properties', { orgId: auth.orgId }],
      queryFn: () => getProperties(auth.supabase, { orgId: auth.orgId }),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MaintenanceClient orgId={auth.orgId} />
    </HydrationBoundary>
  );
}
