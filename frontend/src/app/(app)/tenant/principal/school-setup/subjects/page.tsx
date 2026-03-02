import {
  principalNav,
  principalSchoolSetupHref,
} from "@/components/layout/nav-config";
import { SubjectsSetupPage } from "@/components/school-setup/SubjectsSetupPage";

export default function PrincipalSubjectsSetupPage() {
  return (
    <SubjectsSetupPage
      appTitle="Principal"
      nav={principalNav}
      activeHref={principalSchoolSetupHref("subjects")}
    />
  );
}
