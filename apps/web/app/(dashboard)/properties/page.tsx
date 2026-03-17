import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { getAuthContext } from '@/lib/auth';
import { getProperties } from '@onereal/database';
import { PropertiesClient } from './properties-client';

export default async function PropertiesPage() {
  const auth = await getAuthContext();
  if (!auth) return null;

  const queryClient = new QueryClient();

  await queryClient.prefetchQuery({
    queryKey: ['properties', { orgId: auth.orgId }],
    queryFn: () => getProperties(auth.supabase, { orgId: auth.orgId }),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <PropertiesClient orgId={auth.orgId} />
    </HydrationBoundary>
  );
}
