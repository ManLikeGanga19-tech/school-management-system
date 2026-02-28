import { secretaryHrHref, secretaryNav } from "@/components/layout/nav-config";
import { StaffRegistryPage } from "@/components/hr/StaffRegistryPage";

export default function SecretaryHrStaffPage() {
  return (
    <StaffRegistryPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretaryHrHref("staff")}
      allowCreate={false}
    />
  );
}
