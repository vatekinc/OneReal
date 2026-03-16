import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { UserMenu } from '@/components/dashboard/user-menu';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <span className="text-sm font-medium text-muted-foreground">Platform Admin</span>
          <UserMenu />
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
