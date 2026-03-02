import { directorNav, directorSchoolSetupHref } from "@/components/layout/nav-config";
import { SchoolTimetableSetupPage } from "@/components/school-setup/SchoolTimetableSetupPage";
import { getSchoolTimetableSetupInitialData } from "@/server/tenant/school-timetable";

export default async function DirectorSchoolTimetablePage() {
  const initialData = await getSchoolTimetableSetupInitialData();
  return (
    <SchoolTimetableSetupPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorSchoolSetupHref("timetable")}
      initialData={initialData}
    />
  );
}
