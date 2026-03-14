import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types';

type Client = SupabaseClient<Database>;

export async function getProfile(client: Client, userId: string) {
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data;
}

export async function updateProfile(
  client: Client,
  userId: string,
  updates: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    avatar_url?: string | null;
    default_org_id?: string;
  }
) {
  const { data, error } = await client
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
