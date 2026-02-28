import { directorHrHref, directorNav } from "@/components/layout/nav-config";
import { SchoolAssetsPage } from "@/components/hr/SchoolAssetsPage";

export default function DirectorHrAssetsPage() {
  return (
    <SchoolAssetsPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorHrHref("assets")}
    />
  );
}
