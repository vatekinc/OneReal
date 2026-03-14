'use client';

import { useUser } from '@onereal/auth';
import { createClient, updateProfile } from '@onereal/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@onereal/database';
import { useRouter } from 'next/navigation';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  Button,
} from '@onereal/ui';
import { Building2, ChevronDown, Check } from 'lucide-react';

export function OrgSwitcher() {
  const { activeOrg, organizations, loading } = useUser();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient() as unknown as SupabaseClient<Database>;

  if (loading || !activeOrg) return null;

  async function switchOrg(orgId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await updateProfile(supabase, user.id, { default_org_id: orgId });
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Building2 className="h-4 w-4" />
          <span className="max-w-[150px] truncate">{activeOrg.name}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((mem) => (
          <DropdownMenuItem
            key={mem.org_id}
            onClick={() => switchOrg(mem.org_id)}
            className="gap-2"
          >
            {mem.org_id === activeOrg.id && <Check className="h-4 w-4" />}
            {mem.org_id !== activeOrg.id && <div className="w-4" />}
            <span>{mem.organizations.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
