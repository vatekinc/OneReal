'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn, Button, Sheet, SheetContent, SheetTrigger, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@onereal/ui';
import {
  LayoutDashboard, Building2, CreditCard, Users, Wrench,
  Settings, ChevronLeft, ChevronRight, Menu,
} from 'lucide-react';

const navItems = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard, disabled: false },
  { label: 'Properties', href: '/properties', icon: Building2, disabled: false },
  { label: 'Transactions', href: '/transactions', icon: CreditCard, disabled: true, badge: 'Soon' },
  { label: 'Tenants', href: '/tenants', icon: Users, disabled: true, badge: 'Soon' },
  { label: 'Maintenance', href: '/maintenance', icon: Wrench, disabled: true, badge: 'Soon' },
];

const bottomItems = [
  { label: 'Settings', href: '/settings', icon: Settings, disabled: false },
];

function NavLink({
  item,
  collapsed,
  pathname,
}: {
  item: (typeof navItems)[0];
  collapsed: boolean;
  pathname: string;
}) {
  const isActive =
    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
  const Icon = item.icon;

  const link = (
    <Link
      href={item.disabled ? '#' : item.href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        item.disabled && 'pointer-events-none opacity-50',
        collapsed && 'justify-center px-2'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1">{item.label}</span>
          {item.badge && (
            <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground">
              {item.badge}
            </span>
          )}
        </>
      )}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }

  return link;
}

function SidebarContent({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className={cn('flex items-center gap-2 px-3 py-2', collapsed && 'justify-center')}>
        {!collapsed && <span className="text-lg font-bold">OneReal</span>}
        {collapsed && <span className="text-lg font-bold">O</span>}
        {onToggle && (
          <Button
            variant="ghost"
            size="icon"
            className={cn('ml-auto h-6 w-6', collapsed && 'ml-0')}
            onClick={onToggle}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        <TooltipProvider delayDuration={0}>
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} pathname={pathname} />
          ))}
        </TooltipProvider>
      </nav>

      <nav className="flex flex-col gap-1">
        <TooltipProvider delayDuration={0}>
          {bottomItems.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} pathname={pathname} />
          ))}
        </TooltipProvider>
      </nav>
    </div>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden h-screen border-r bg-card transition-all duration-300 md:block',
          collapsed ? 'w-[60px]' : 'w-[240px]'
        )}
      >
        <SidebarContent collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </aside>

      {/* Mobile sidebar */}
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="fixed left-4 top-3 z-40 md:hidden">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[240px] p-0">
          <SidebarContent collapsed={false} />
        </SheetContent>
      </Sheet>
    </>
  );
}
