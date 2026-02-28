import { secretaryHrHref, secretaryNav } from "@/components/layout/nav-config";
import { SchoolAssetsPage } from "@/components/hr/SchoolAssetsPage";

export default function SecretaryHrAssetsPage() {
  return (
    <SchoolAssetsPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretaryHrHref("assets")}
    />
  );
}
