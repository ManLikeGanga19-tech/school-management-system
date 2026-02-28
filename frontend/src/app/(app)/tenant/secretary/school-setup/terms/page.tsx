import { secretaryNav, secretarySchoolSetupHref } from "@/components/layout/nav-config";
import { TermsSetupPage } from "@/components/school-setup/TermsSetupPage";

export default function SecretaryTermsSetupPage() {
  return (
    <TermsSetupPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretarySchoolSetupHref("terms")}
    />
  );
}
