import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types';

type Client = SupabaseClient<Database>;

export interface PropertyFilters {
  orgId: string;
  type?: string;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function getProperties(client: Client, filters: PropertyFilters) {
  const { orgId, type, status, search, page = 1, pageSize = 20 } = filters;

  let query = client
    .from('properties')
    .select('*, units(id, status, rent_amount)', { count: 'exact' })
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (type) query = query.eq('type', type);
  if (status) query = query.eq('status', status);
  if (search) {
    query = query.or(
      `name.ilike.%${search}%,address_line1.ilike.%${search}%,city.ilike.%${search}%`
    );
  }

  const { data, error, count } = await query;

  if (error) throw error;
  return { data: data ?? [], count: count ?? 0 };
}

export async function getProperty(client: Client, propertyId: string) {
  const { data, error } = await client
    .from('properties')
    .select('*, units(*), property_images(*)')
    .eq('id', propertyId)
    .single();

  if (error) throw error;
  return data;
}

export async function getPortfolioStats(client: Client, orgId: string) {
  const { data: properties, error } = await client
    .from('properties')
    .select('id, units(id, status, rent_amount)')
    .eq('org_id', orgId);

  if (error) throw error;

  const allUnits = (properties ?? []).flatMap((p) => p.units ?? []);
  const occupiedUnits = allUnits.filter((u) => u.status === 'occupied');
  const totalRent = allUnits.reduce((sum, u) => sum + (Number(u.rent_amount) || 0), 0);

  return {
    total_properties: properties?.length ?? 0,
    total_units: allUnits.length,
    occupied_units: occupiedUnits.length,
    occupancy_rate:
      allUnits.length > 0
        ? Math.round((occupiedUnits.length / allUnits.length) * 100)
        : 0,
    total_rent_potential: totalRent,
  };
}
