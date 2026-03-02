import {
  principalNav,
  principalSchoolSetupHref,
} from "@/components/layout/nav-config";
import { SchoolTimetableSetupPage } from "@/components/school-setup/SchoolTimetableSetupPage";
import { getSchoolTimetableSetupInitialData } from "@/server/tenant/school-timetable";

export default async function PrincipalSchoolTimetablePage() {
  const initialData = await getSchoolTimetableSetupInitialData();
  return (
    <SchoolTimetableSetupPage
      appTitle="Principal"
      nav={principalNav}
      activeHref={principalSchoolSetupHref("timetable")}
      initialData={initialData}
    />
  );
}
