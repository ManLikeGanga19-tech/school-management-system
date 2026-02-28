import { directorNav, directorSchoolSetupHref } from "@/components/layout/nav-config";
import { ClassesSetupPage } from "@/components/school-setup/ClassesSetupPage";

export default function DirectorClassesSetupPage() {
  return (
    <ClassesSetupPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorSchoolSetupHref("classes")}
    />
  );
}
