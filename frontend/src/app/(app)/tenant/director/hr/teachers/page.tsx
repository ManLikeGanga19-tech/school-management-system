import { directorHrHref, directorNav } from "@/components/layout/nav-config";
import { TeacherAssignmentsPage } from "@/components/hr/TeacherAssignmentsPage";

export default function DirectorHrTeachersPage() {
  return (
    <TeacherAssignmentsPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorHrHref("teachers")}
    />
  );
}
