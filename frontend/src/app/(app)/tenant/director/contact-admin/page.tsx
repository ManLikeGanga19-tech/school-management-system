import { TenantContactAdminPage } from "@/components/support/TenantContactAdminPage";
import { directorNav } from "@/components/layout/nav-config";

export default function DirectorContactAdminPage() {
  return (
    <TenantContactAdminPage
      appTitle="Director"
      nav={directorNav}
      activeHref="/tenant/director/contact-admin"
    />
  );
}
