import { AttendancePage } from "@/components/students/AttendancePage";
import { directorNav, directorStudentsHref } from "@/components/layout/nav-config";

export default function DirectorAttendancePage() {
  return (
    <AttendancePage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorStudentsHref("attendance")}
    />
  );
}
