import {
  secretaryNav,
  secretaryStudentsHref,
} from "@/components/layout/nav-config";
import { StudentFeeBalancePage } from "@/components/students/StudentFeeBalancePage";

export default function SecretaryStudentFeeBalancePage() {
  return (
    <StudentFeeBalancePage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretaryStudentsHref("fee-balance")}
      financePath="/tenants/secretary/finance"
    />
  );
}
