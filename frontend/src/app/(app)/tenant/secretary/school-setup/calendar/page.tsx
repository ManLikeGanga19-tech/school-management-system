import { secretaryNav, secretarySchoolSetupHref } from "@/components/layout/nav-config";
import { SchoolCalendarSetupPage } from "@/components/school-setup/SchoolCalendarSetupPage";

export default function SecretarySchoolCalendarSetupPage() {
  return (
    <SchoolCalendarSetupPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretarySchoolSetupHref("calendar")}
    />
  );
}
