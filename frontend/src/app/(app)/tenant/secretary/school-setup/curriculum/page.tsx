import { CurriculumSetupPage } from "@/components/school-setup/CurriculumSetupPage";
import { secretaryNav, secretarySchoolSetupHref } from "@/components/layout/nav-config";

export default function SecretaryCurriculumPage() {
  return (
    <CurriculumSetupPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretarySchoolSetupHref("curriculum")}
      readonly={true}
    />
  );
}
