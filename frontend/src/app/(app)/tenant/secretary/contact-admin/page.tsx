import { secretaryNav } from "@/components/layout/nav-config";
import { TenantContactAdminPage } from "@/components/support/TenantContactAdminPage";

export default function SecretaryContactAdminPage() {
  return (
    <TenantContactAdminPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref="/tenant/secretary/contact-admin"
    />
  );
}
