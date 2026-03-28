import { AttendancePage } from "@/components/students/AttendancePage";
import { secretaryNav, secretaryStudentsHref } from "@/components/layout/nav-config";

export default function SecretaryAttendancePage() {
  return (
    <AttendancePage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretaryStudentsHref("attendance")}
    />
  );
}
