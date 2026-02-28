import {
  directorNav,
  directorStudentsHref,
} from "@/components/layout/nav-config";
import { StudentFeeBalancePage } from "@/components/students/StudentFeeBalancePage";

export default function DirectorStudentFeeBalancePage() {
  return (
    <StudentFeeBalancePage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorStudentsHref("fee-balance")}
      financePath="/tenants/director/finance"
    />
  );
}
