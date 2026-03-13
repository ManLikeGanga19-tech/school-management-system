import { directorNav, directorSchoolSetupHref } from "@/components/layout/nav-config";
import { SchoolCalendarSetupPage } from "@/components/school-setup/SchoolCalendarSetupPage";

export default function DirectorSchoolCalendarSetupPage() {
  return (
    <SchoolCalendarSetupPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorSchoolSetupHref("calendar")}
    />
  );
}
