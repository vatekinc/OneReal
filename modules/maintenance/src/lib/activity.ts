type Db = any;

export async function getAuthorName(supabase: Db, userId: string, email?: string | null): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('first_name, last_name, email')
    .eq('id', userId)
    .maybeSingle();
  const name = [data?.first_name, data?.last_name].filter(Boolean).join(' ').trim();
  return name || data?.email || email || 'Unknown';
}
