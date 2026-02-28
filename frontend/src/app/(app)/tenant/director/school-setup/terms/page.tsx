import { directorNav, directorSchoolSetupHref } from "@/components/layout/nav-config";
import { TermsSetupPage } from "@/components/school-setup/TermsSetupPage";

export default function DirectorTermsSetupPage() {
  return (
    <TermsSetupPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorSchoolSetupHref("terms")}
    />
  );
}
