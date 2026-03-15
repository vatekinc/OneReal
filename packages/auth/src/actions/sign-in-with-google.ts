'use server';

import { createServerSupabaseClient } from '@onereal/database/server';
import { redirect } from 'next/navigation';

export async function signInWithGoogle() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/callback`,
    },
  });

  if (error) {
    return { success: false as const, error: error.message };
  }

  redirect(data.url);
}
