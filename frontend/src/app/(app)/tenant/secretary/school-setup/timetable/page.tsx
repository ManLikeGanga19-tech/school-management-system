import { secretaryNav, secretarySchoolSetupHref } from "@/components/layout/nav-config";
import { SchoolTimetableSetupPage } from "@/components/school-setup/SchoolTimetableSetupPage";
import { getSchoolTimetableSetupInitialData } from "@/server/tenant/school-timetable";

export default async function SecretarySchoolTimetablePage() {
  const initialData = await getSchoolTimetableSetupInitialData();
  return (
    <SchoolTimetableSetupPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretarySchoolSetupHref("timetable")}
      initialData={initialData}
    />
  );
}
