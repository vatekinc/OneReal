'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn, Button, Sheet, SheetContent, SheetTrigger, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@onereal/ui';
import {
  LayoutDashboard, Building2, Calculator, Users, Wrench,
  Settings, ChevronLeft, ChevronRight, ChevronDown, Menu,
} from 'lucide-react';

interface NavChild {
  label: string;
  href: string;
}

interface NavItem {
  label: string;
  href: string;
  icon: any;
  disabled?: boolean;
  badge?: string;
  children?: NavChild[];
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Properties', href: '/properties', icon: Building2 },
  {
    label: 'Accounting', href: '/accounting', icon: Calculator,
    children: [
      { label: 'Financial Overview', href: '/accounting' },
      { label: 'Incoming', href: '/accounting/incoming' },
      { label: 'Outgoing', href: '/accounting/outgoing' },
    ],
  },
  {
    label: 'Contacts', href: '/contacts', icon: Users,
    children: [
      { label: 'Tenants', href: '/contacts/tenants' },
      { label: 'Service Providers', href: '/contacts/providers' },
    ],
  },
  { label: 'Maintenance', href: '/maintenance', icon: Wrench, disabled: true, badge: 'Soon' },
];

const bottomItems: NavItem[] = [
  { label: 'Settings', href: '/settings', icon: Settings },
];

function NavLink({
  item,
  collapsed,
  pathname,
}: {
  item: NavItem;
  collapsed: boolean;
  pathname: string;
}) {
  const isParentActive = item.href === '/'
    ? pathname === '/'
    : pathname.startsWith(item.href);
  const hasChildren = item.children && item.children.length > 0;
  const [expanded, setExpanded] = useState(isParentActive && hasChildren);
  const Icon = item.icon;

  // For items with children
  if (hasChildren && !collapsed) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
            isParentActive
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
        </button>
        {expanded && (
          <div className="ml-4 mt-1 flex flex-col gap-1 border-l pl-3">
            {item.children!.map((child) => {
              const isChildActive = child.href === '/accounting'
                ? pathname === child.href
                : pathname.startsWith(child.href);
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm transition-colors',
                    isChildActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {child.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Collapsed sidebar with children — navigate to first child
  const href = item.disabled
    ? '#'
    : hasChildren
      ? item.children![0].href
      : item.href;

  const link = (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
        isParentActive
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
