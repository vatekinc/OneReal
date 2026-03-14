'use server';

import { createServerSupabaseClient } from '@onereal/database';
import { redirect } from 'next/navigation';

export async function signOut() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect('/login');
}
