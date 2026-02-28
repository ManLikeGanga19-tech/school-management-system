import { directorNav, directorSchoolSetupHref } from "@/components/layout/nav-config";
import { SubjectsSetupPage } from "@/components/school-setup/SubjectsSetupPage";

export default function DirectorSubjectsSetupPage() {
  return (
    <SubjectsSetupPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorSchoolSetupHref("subjects")}
    />
  );
}
