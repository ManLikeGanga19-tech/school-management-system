import { principalNav, principalSchoolSetupHref } from "@/components/layout/nav-config";
import { SchoolCalendarSetupPage } from "@/components/school-setup/SchoolCalendarSetupPage";

export default function PrincipalSchoolCalendarSetupPage() {
  return (
    <SchoolCalendarSetupPage
      appTitle="Principal"
      nav={principalNav}
      activeHref={principalSchoolSetupHref("calendar")}
    />
  );
}
