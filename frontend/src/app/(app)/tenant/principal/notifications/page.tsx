import {
  principalNav,
  principalNotificationsHref,
} from "@/components/layout/nav-config";
import { TenantNotificationsPage } from "@/components/notifications/TenantNotificationsPage";

export default function PrincipalNotificationsPage() {
  return (
    <TenantNotificationsPage
      appTitle="Principal"
      nav={principalNav}
      activeHref={principalNotificationsHref()}
    />
  );
}
