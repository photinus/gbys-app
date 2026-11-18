import { PillTabs } from "./pill-tabs";
import type { NavItem } from "./nav";
import { UserMenu, type ShellUser } from "./user-menu";

export function TopBar({ items, user }: { items: NavItem[]; user: ShellUser }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 pb-6">
      <PillTabs items={items.map(({ label, href }) => ({ label, href }))} />
      <div className="flex items-center gap-2.5 ml-auto">
        <UserMenu user={user} />
      </div>
    </header>
  );
}
