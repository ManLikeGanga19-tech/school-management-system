import {
  secretaryNav,
  secretaryNotificationsHref,
} from "@/components/layout/nav-config";
import { TenantNotificationsPage } from "@/components/notifications/TenantNotificationsPage";

export default function SecretaryNotificationsPage() {
  return (
    <TenantNotificationsPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretaryNotificationsHref()}
    />
  );
}
