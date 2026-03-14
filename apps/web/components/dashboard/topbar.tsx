import { Breadcrumbs } from './breadcrumbs';
import { OrgSwitcher } from './org-switcher';
import { UserMenu } from './user-menu';

export function Topbar() {
  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <div className="pl-10 md:pl-0">
        <Breadcrumbs />
      </div>
      <div className="flex items-center gap-3">
        <OrgSwitcher />
        <UserMenu />
      </div>
    </header>
  );
}
