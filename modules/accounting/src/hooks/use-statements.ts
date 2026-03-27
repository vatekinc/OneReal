'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient, getTenantStatement, getPropertyStatement, getRentRoll } from '@onereal/database';

interface DateRange {
  from: string;
  to: string;
}

export function useTenantStatement(
  orgId: string | null,
  tenantId: string | null,
  propertyId: string | null,
  dateRange?: DateRange,
) {
  return useQuery({
    queryKey: ['tenant-statement', orgId, tenantId, propertyId, dateRange?.from, dateRange?.to],
    queryFn: () => {
      const supabase = createClient();
      return getTenantStatement(supabase as any, orgId!, tenantId!, propertyId!, dateRange);
    },
    enabled: !!orgId && !!tenantId && !!propertyId,
  });
}

export function usePropertyStatement(
  orgId: string | null,
  propertyId: string | null,
  dateRange?: DateRange,
) {
  return useQuery({
    queryKey: ['property-statement', orgId, propertyId, dateRange?.from, dateRange?.to],
    queryFn: () => {
      const supabase = createClient();
      return getPropertyStatement(supabase as any, orgId!, propertyId!, dateRange);
    },
    enabled: !!orgId && !!propertyId,
  });
}

export function useRentRoll(
  orgId: string | null,
  leaseStatus: string = 'active',
  propertyId?: string,
) {
  return useQuery({
    queryKey: ['rent-roll', orgId, leaseStatus, propertyId],
    queryFn: () => {
      const supabase = createClient();
      return getRentRoll(supabase as any, orgId!, leaseStatus, propertyId);
    },
    enabled: !!orgId,
  });
}
