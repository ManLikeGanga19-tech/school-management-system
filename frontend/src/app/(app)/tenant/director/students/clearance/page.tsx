import {
  directorNav,
  directorStudentsHref,
} from "@/components/layout/nav-config";
import { StudentClearancePage } from "@/components/students/StudentClearancePage";

export default function DirectorStudentClearanceRoute() {
  return (
    <StudentClearancePage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorStudentsHref("clearance")}
      roleContext="director"
    />
  );
}
