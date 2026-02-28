import {
  directorNav,
  directorNotificationsHref,
} from "@/components/layout/nav-config";
import { TenantNotificationsPage } from "@/components/notifications/TenantNotificationsPage";

export default function DirectorNotificationsPage() {
  return (
    <TenantNotificationsPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorNotificationsHref()}
    />
  );
}
