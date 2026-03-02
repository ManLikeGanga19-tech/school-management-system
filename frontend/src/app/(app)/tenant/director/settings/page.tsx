import { directorNav } from "@/components/layout/nav-config";
import { TenantSettingsPage } from "@/components/settings/TenantSettingsPage";

export default function DirectorSettingsRoute() {
  return (
    <TenantSettingsPage
      appTitle="Director"
      nav={directorNav}
      activeHref="/tenant/director/settings"
      roleContext="director"
    />
  );
}
