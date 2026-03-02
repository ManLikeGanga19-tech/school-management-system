import {
  principalNav,
  principalSchoolSetupHref,
} from "@/components/layout/nav-config";
import { TermsSetupPage } from "@/components/school-setup/TermsSetupPage";

export default function PrincipalTermsSetupPage() {
  return (
    <TermsSetupPage
      appTitle="Principal"
      nav={principalNav}
      activeHref={principalSchoolSetupHref("terms")}
    />
  );
}
