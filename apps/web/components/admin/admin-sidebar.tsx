'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@onereal/ui';
import { LayoutDashboard, Building2, CreditCard, Users, ArrowLeft } from 'lucide-react';

const adminNavItems = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { label: 'Organizations', href: '/admin/organizations', icon: Building2 },
  { label: 'Plans', href: '/admin/plans', icon: CreditCard },
  { label: 'Users', href: '/admin/users', icon: Users },
];

export function AdminSidebar() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  }

  return (
    <aside className="hidden h-screen w-[240px] border-r bg-card md:block">
      <div className="flex h-full flex-col gap-2 p-3">
        {/* Branding */}
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-lg font-bold">OneReal</span>
          <span className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground">
            Admin
          </span>
        </div>

        {/* Nav items */}
        <nav className="flex flex-1 flex-col gap-1">
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Back to app */}
        <nav className="flex flex-col gap-1 border-t pt-2">
          <Link
            href="/"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span>Back to App</span>
          </Link>
        </nav>
      </div>
    </aside>
  );
}
