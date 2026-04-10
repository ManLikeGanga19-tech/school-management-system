import { secretaryHrHref, secretaryNav } from "@/components/layout/nav-config";
import { LeaveManagementPage } from "@/components/hr/LeaveManagementPage";

export default function SecretaryHrLeavePage() {
  return (
    <LeaveManagementPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretaryHrHref("leave")}
      canApprove={false}
    />
  );
}
