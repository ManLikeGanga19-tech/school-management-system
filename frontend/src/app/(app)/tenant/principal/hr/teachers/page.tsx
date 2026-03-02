import { TeacherAssignmentsPage } from "@/components/hr/TeacherAssignmentsPage";
import { principalHrHref, principalNav } from "@/components/layout/nav-config";

export default function PrincipalHrTeachersPage() {
  return (
    <TeacherAssignmentsPage
      appTitle="Principal"
      nav={principalNav}
      activeHref={principalHrHref("teachers")}
    />
  );
}
