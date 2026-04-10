import { directorHrHref, directorNav } from "@/components/layout/nav-config";
import { LeaveManagementPage } from "@/components/hr/LeaveManagementPage";

export default function DirectorHrLeavePage() {
  return (
    <LeaveManagementPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorHrHref("leave")}
      canApprove={true}
    />
  );
}
