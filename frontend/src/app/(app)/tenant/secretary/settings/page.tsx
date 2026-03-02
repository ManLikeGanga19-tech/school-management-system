import { secretaryNav } from "@/components/layout/nav-config";
import { TenantSettingsPage } from "@/components/settings/TenantSettingsPage";

export default function SecretarySettingsRoute() {
  return (
    <TenantSettingsPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref="/tenant/secretary/settings"
      roleContext="secretary"
    />
  );
}
