import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getProfile, getPortfolioStats } from '@onereal/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@onereal/database';
import { StatCard, Button } from '@onereal/ui';
import { Building2, DoorOpen, Percent, DollarSign, Plus } from 'lucide-react';
import Link from 'next/link';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export default async function DashboardPage() {
  const supabaseRaw = await createServerSupabaseClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = supabaseRaw as unknown as SupabaseClient<Database>;

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const profile = await getProfile(supabase, user.id).catch(() => null) as ProfileRow | null;

  if (!profile?.default_org_id) return null;

  const stats = await getPortfolioStats(supabase, profile.default_org_id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of your portfolio</p>
        </div>
        <Link href="/properties/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> Add Property
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Properties"
          value={stats.total_properties}
          icon={Building2}
          description="Active properties"
        />
        <StatCard
          title="Total Units"
          value={stats.total_units}
          icon={DoorOpen}
          description={`${stats.occupied_units} occupied`}
        />
        <StatCard
          title="Occupancy Rate"
          value={`${stats.occupancy_rate}%`}
          icon={Percent}
          description="Across all properties"
        />
        <StatCard
          title="Rent Potential"
          value={`$${stats.total_rent_potential.toLocaleString()}`}
          icon={DollarSign}
          description="Monthly total"
        />
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h3 className="mb-2 font-medium">Recent Activity</h3>
        <p className="text-sm text-muted-foreground">
          Activity will appear here as you manage properties.
        </p>
      </div>
    </div>
  );
}
