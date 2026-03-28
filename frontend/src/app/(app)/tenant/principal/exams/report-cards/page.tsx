import { ReportCardsPage } from "@/components/exams/ReportCardsPage";
import { principalNav, principalExamsHref } from "@/components/layout/nav-config";

export default function PrincipalReportCardsPage() {
  return (
    <ReportCardsPage
      appTitle="Principal"
      nav={principalNav}
      activeHref={principalExamsHref("report-cards")}
      role="secretary"
    />
  );
}
