import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { getAuthContext } from '@/lib/auth';
import { TenantsClient } from './tenants-client';

export default async function TenantsPage() {
  const auth = await getAuthContext();
  if (!auth) return null;

  const queryClient = new QueryClient();

  await queryClient.prefetchQuery({
    queryKey: ['tenants', { orgId: auth.orgId }],
    queryFn: async () => {
      const { data, error } = await (auth.supabase as any)
        .from('tenants')
        .select('*, leases(id, status, unit_id, units(unit_number, property_id, properties(id, name)))')
        .eq('org_id', auth.orgId)
        .order('last_name', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TenantsClient orgId={auth.orgId} />
    </HydrationBoundary>
  );
}
