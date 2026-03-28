import { LayoutDashboard } from "lucide-react";
import { type ReactNode } from "react";

import { NotificationBell } from "@/web/components/layout/NotificationBell";
import { UserMenu } from "@/web/components/layout/UserMenu";
import { AppShell } from "@/web/components/ui/AppShell";
import { Text } from "@/web/components/ui/Text";

const APP_NAME = "App Name";

interface AuthenticatedLayoutProps {
  children: ReactNode;
}

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  return (
    <AppShell defaultOpen>
      <AppShell.Navbar>
        <AppShell.Toggle />
        <AppShell.Brand>
          <Text variant="h6">{APP_NAME}</Text>
        </AppShell.Brand>
        <AppShell.NavbarActions>
          <NotificationBell />
        </AppShell.NavbarActions>
      </AppShell.Navbar>

      <AppShell.Sidebar>
        <AppShell.SidebarSection>
          <AppShell.SidebarLink to="/" icon={LayoutDashboard}>
            Dashboard
          </AppShell.SidebarLink>
        </AppShell.SidebarSection>

        {/* User menu — pushed to bottom */}
        <AppShell.SidebarSection className="mt-auto">
          <UserMenu />
        </AppShell.SidebarSection>
      </AppShell.Sidebar>

      <AppShell.Main>
        {children}
      </AppShell.Main>
    </AppShell>
  );
}
