import {
  secretaryNav,
  secretaryStudentsHref,
} from "@/components/layout/nav-config";
import { StudentClearancePage } from "@/components/students/StudentClearancePage";

export default function SecretaryStudentClearanceRoute() {
  return (
    <StudentClearancePage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretaryStudentsHref("clearance")}
      roleContext="secretary"
    />
  );
}
