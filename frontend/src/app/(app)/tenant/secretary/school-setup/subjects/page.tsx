import { secretaryNav, secretarySchoolSetupHref } from "@/components/layout/nav-config";
import { SubjectsSetupPage } from "@/components/school-setup/SubjectsSetupPage";

export default function SecretarySubjectsSetupPage() {
  return (
    <SubjectsSetupPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretarySchoolSetupHref("subjects")}
    />
  );
}
