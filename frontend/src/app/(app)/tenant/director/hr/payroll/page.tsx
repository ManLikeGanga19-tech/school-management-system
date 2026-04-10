import { directorHrHref, directorNav } from "@/components/layout/nav-config";
import { PayrollPage } from "@/components/hr/PayrollPage";

export default function DirectorHrPayrollPage() {
  return (
    <PayrollPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorHrHref("payroll")}
    />
  );
}
