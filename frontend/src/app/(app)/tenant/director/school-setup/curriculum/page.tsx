import { CurriculumSetupPage } from "@/components/school-setup/CurriculumSetupPage";
import { directorNav, directorSchoolSetupHref } from "@/components/layout/nav-config";

export default function DirectorCurriculumPage() {
  return (
    <CurriculumSetupPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorSchoolSetupHref("curriculum")}
      readonly={false}
    />
  );
}
