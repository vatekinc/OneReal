import { createServerSupabaseClient } from '@onereal/database/server';

/**
 * Verifies the current user is a platform admin.
 * Returns the user ID if authorized, throws if not.
 */
export async function requireAdmin(): Promise<string> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Not authenticated');
  }

  // Type assertion needed: Supabase v2.99 typed client produces `never`
  // for select queries on manually-maintained Database types
  const { data: profile } = (await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()) as { data: { is_platform_admin: boolean } | null };

  if (!profile?.is_platform_admin) {
    throw new Error('Not authorized — platform admin required');
  }

  return user.id;
}
