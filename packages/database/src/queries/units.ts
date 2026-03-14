import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types';

type Client = SupabaseClient<Database>;

export async function getUnits(client: Client, propertyId: string) {
  const { data, error } = await client
    .from('units')
    .select('*')
    .eq('property_id', propertyId)
    .order('unit_number');

  if (error) throw error;
  return data ?? [];
}

export async function getUnit(client: Client, unitId: string) {
  const { data, error } = await client
    .from('units')
    .select('*')
    .eq('id', unitId)
    .single();

  if (error) throw error;
  return data;
}
