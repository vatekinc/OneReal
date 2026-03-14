'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

const labelMap: Record<string, string> = {
  '': 'Dashboard',
  properties: 'Properties',
  new: 'New Property',
  edit: 'Edit',
  transactions: 'Transactions',
  tenants: 'Tenants',
  maintenance: 'Maintenance',
  settings: 'Settings',
  profile: 'Profile',
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  // Build breadcrumb items
  const items = segments.map((segment, index) => {
    const href = '/' + segments.slice(0, index + 1).join('/');
    const label = labelMap[segment] || segment;
    const isLast = index === segments.length - 1;
    return { label, href, isLast };
  });

  // Prepend Dashboard if not on root
  if (segments.length > 0) {
    items.unshift({ label: 'Dashboard', href: '/', isLast: false });
  }

  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {items.map((item, index) => (
        <span key={item.href} className="flex items-center gap-1.5">
          {index > 0 && <span>/</span>}
          {item.isLast ? (
            <span className="font-medium text-foreground">{item.label}</span>
          ) : (
            <Link href={item.href} className="hover:text-foreground">{item.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}
