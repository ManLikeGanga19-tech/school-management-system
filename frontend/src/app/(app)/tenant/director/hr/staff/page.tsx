import { directorHrHref, directorNav } from "@/components/layout/nav-config";
import { StaffRegistryPage } from "@/components/hr/StaffRegistryPage";

export default function DirectorHrStaffPage() {
  return (
    <StaffRegistryPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorHrHref("staff")}
    />
  );
}
