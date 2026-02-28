import { secretaryHrHref, secretaryNav } from "@/components/layout/nav-config";
import { TeacherAssignmentsPage } from "@/components/hr/TeacherAssignmentsPage";

export default function SecretaryHrTeachersPage() {
  return (
    <TeacherAssignmentsPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretaryHrHref("teachers")}
    />
  );
}
